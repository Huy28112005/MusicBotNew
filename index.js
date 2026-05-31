const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { Shoukaku, Connectors } = require('shoukaku');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const nodes = [
    {
        name: process.env.LAVALINK_NODE_NAME || 'local',
        url: process.env.LAVALINK_URL || 'localhost:2333',
        auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
        secure: process.env.LAVALINK_SECURE === 'true'
    }
];

const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    resume: true,
    resumeTimeout: 60,
    reconnectTries: 5,
    reconnectInterval: 5
});

shoukaku.on('ready', (name) => console.log(`✅ Lavalink node ready: ${name}`));
shoukaku.on('error', (name, error) => console.log(`❌ Lavalink error on ${name}: ${error.message}`));

const queues = new Map();

function buildSearchIdentifier(input) {
    const trimmed = input.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;

    const prefixMatch = trimmed.match(/^(yt|sc|sp)(search)?:\s*(.+)$/i);
    if (prefixMatch) {
        const prefix = prefixMatch[1].toLowerCase();
        const term = prefixMatch[3].trim();
        if (!term) return null;
        const map = { yt: 'ytsearch', sc: 'scsearch', sp: 'spsearch' };
        if (/^https?:\/\//i.test(term)) return term;
        return `${map[prefix]}:${term}`;
    }

    return `ytsearch:${trimmed}`;
}

function isSpotifyIdentifier(identifier) {
    if (!identifier) return false;
    return identifier.startsWith('spsearch:') ||
        identifier.includes('open.spotify.com') ||
        identifier.startsWith('spotify:');
}


async function resolveTracks(node, identifier) {
    let result;
    try {
        result = await node.rest.resolve(identifier);
    } catch (error) {
        throw new Error(`Lavalink resolve error: ${error?.message || error}`);
    }
    if (!result) return { tracks: [], playlistName: null, loadType: 'empty' };

    switch (result.loadType) {
        case 'track':
            return { tracks: [result.data], playlistName: null, loadType: 'track' };
        case 'playlist':
            return { tracks: result.data.tracks, playlistName: result.data.info?.name || 'Playlist', loadType: 'playlist' };
        case 'search':
            return { tracks: result.data, playlistName: null, loadType: 'search' };
        case 'empty':
            return { tracks: [], playlistName: null, loadType: 'empty' };
        case 'error':
            throw new Error(`${result.data?.message || 'Lavalink error'}${result.data?.cause ? ` (${result.data.cause})` : ''}`);
        default:
            return { tracks: [], playlistName: null, loadType: 'empty' };
    }
}

async function playNext(guildId) {
    const state = queues.get(guildId);
    if (!state || state.playing) return;

    let next = null;
    while (state.queue.length) {
        const candidate = state.queue.shift();
        if (candidate?.track?.encoded) {
            next = candidate;
            break;
        }
    }

    if (!next) {
        state.playing = false;
        state.current = null;
        await shoukaku.leaveVoiceChannel(guildId);
        queues.delete(guildId);
        return;
    }

    state.playing = true;
    state.current = next.track;
    await state.player.playTrack({ track: { encoded: next.track.encoded } });
}

function attachPlayerEvents(state) {
    const { player, guildId } = state;

    player.on('start', (data) => {
        const current = queues.get(guildId);
        if (!current) return;
        const info = data.track.info;
        const channel = client.channels.cache.get(current.textChannelId);
        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setTitle('🎶 Đang phát')
            .setDescription(`**${info.title}**\n${info.uri || 'N/A'}`)
            .setColor('#1DB954');

        if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);

        channel.send({ embeds: [embed] });
    });

    player.on('end', async (data) => {
        const current = queues.get(guildId);
        if (!current) return;
        if (data.reason === 'replaced') return;
        current.playing = false;
        current.current = null;
        await playNext(guildId);
    });

    player.on('exception', async () => {
        const current = queues.get(guildId);
        if (!current) return;
        current.playing = false;
        current.current = null;
        await playNext(guildId);
    });

    player.on('stuck', async () => {
        const current = queues.get(guildId);
        if (!current) return;
        current.playing = false;
        current.current = null;
        await playNext(guildId);
    });
}

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const prefix = '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    if (command === 'play') {
        let query = args.join(' ');
        if (!query) return message.reply('❌ Nhập tên bài hát hoặc link!');

        const channel = message.member.voice.channel;
        if (!channel) return message.reply('❌ Bạn phải vào kênh voice!');

        if (/open\.spotify\.com/i.test(query) || /^spotify:/i.test(query) || /^(sp|spsearch)\s*:/i.test(query)) {
            return message.reply('⛔ Tạm thời đã tắt tìm kiếm/phát Spotify. Vui lòng dùng YouTube hoặc SoundCloud.');
        }

        const guildId = message.guild.id;
        const node = shoukaku.getIdealNode();
        if (!node) return message.reply('❌ Lavalink chưa sẵn sàng.');

        try {
            let state = queues.get(guildId);
            if (state && state.voiceChannelId !== channel.id) {
                return message.reply('❌ Bot đang phát ở kênh voice khác.');
            }

            if (!state) {
                const player = await shoukaku.joinVoiceChannel({
                    guildId,
                    channelId: channel.id,
                    shardId: message.guild.shardId ?? 0,
                    deaf: true
                });

                await player.setGlobalVolume(100);

                state = {
                    guildId,
                    voiceChannelId: channel.id,
                    textChannelId: message.channel.id,
                    sessionOwner: message.author.id,
                    player,
                    queue: [],
                    playing: false,
                    current: null
                };

                attachPlayerEvents(state);
                queues.set(guildId, state);
            }

            state.textChannelId = message.channel.id;

            const identifier = buildSearchIdentifier(query);
            if (!identifier) {
                return message.reply('❌ Cú pháp tìm kiếm không hợp lệ. Dùng `yt:`, `sc:`, hoặc `sp:` trước từ khóa.');
            }

            let tracksResult;
            let playlistName;
            let loadType;

            try {
                tracksResult = await resolveTracks(node, identifier);
                playlistName = tracksResult.playlistName;
                loadType = tracksResult.loadType;
            } catch (error) {
                if (isSpotifyIdentifier(identifier)) {
                    return message.reply('❌ Spotify không thể phát. Vui lòng kiểm tra Premium hoặc cấu hình Spotify API.');
                }
                throw error;
            }

            const { tracks } = tracksResult;
            if (!tracks.length) return message.reply('❌ Không tìm thấy bài hát phù hợp.');

            const enqueueTracks = loadType === 'search' ? [tracks[0]] : tracks;

            for (const track of enqueueTracks) {
                state.queue.push({ track, requestedBy: message.author.id });
            }

            if (!state.playing && !state.player.track) {
                await playNext(guildId);
            }

            const firstTrack = tracks[0];
            const reply = playlistName
                ? `✅ **Chủ phòng:** ${client.users.cache.get(state.sessionOwner)?.username || 'Unknown'}\n📃 Đã thêm playlist: **${playlistName}** (${tracks.length} bài)`
                : `✅ **Chủ phòng:** ${client.users.cache.get(state.sessionOwner)?.username || 'Unknown'}\n⌛ Đã thêm: **${firstTrack.info.title}**`;

            return message.reply(reply);
        } catch (e) {
            console.error(e);
            return message.reply(`❌ Lỗi: Không thể phát bài hát này.`);
        }
    }

    if (command === 'skip') {
        const state = queues.get(message.guild.id);
        if (!state || !state.player.track) return message.reply('❌ Không có nhạc đang phát!');

        // KIỂM TRA QUYỀN
        if (message.author.id !== state.sessionOwner) {
            return message.reply(`⛔ Chỉ có **Chủ phòng** (${client.users.cache.get(state.sessionOwner)?.username}) mới có quyền Skip!`);
        }

        await state.player.stopTrack();
        return message.reply('⏭️ **Chủ phòng** đã bỏ qua bài hát.');
    }

    if (command === 'stop') {
        const state = queues.get(message.guild.id);
        if (!state) return message.reply('❌ Bot không có trong kênh voice!');

        // KIỂM TRA QUYỀN
        if (message.author.id !== state.sessionOwner) {
            return message.reply(`⛔ Chỉ có **Chủ phòng** mới có quyền dừng Bot!`);
        }

        state.queue = [];
        state.playing = false;
        await state.player.stopTrack();
        await shoukaku.leaveVoiceChannel(state.guildId);
        queues.delete(state.guildId);
        return message.reply('🛑 **Chủ phòng** đã dừng nhạc và mời Bot rời kênh.');
    }
});

client.once('ready', () => {
    console.log(`✅ Bot đã sẵn sàng: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);

const { Client, Events, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { token, text_channel_id, voice_channel_id } = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.once(Events.ClientReady, readyClient => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(token);

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const voiceChannel = newState.guild.channels.cache.get(voice_channel_id);
    if (!voiceChannel || voiceChannel.members.size !== 1) return;

    if (oldState.channelId === null && newState.channelId !== null) { // Join
        if (newState.channelId === voice_channel_id) {
            const textChannel = newState.guild.channels.cache.get(text_channel_id);

            const embed = new EmbedBuilder()
                .setColor(0x006e54)
                .setTitle(`🔊 ${voiceChannel.name}`)
            textChannel.send({ embeds: [embed] });
        }
    }
});

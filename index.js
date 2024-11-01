import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
} from "discord.js";
import Config from "./config.json" with { type: "json" };

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// Store the ID of the current message
let currentMessageId = null;
const userStatus = new Map();

const STATUS_TYPES = {
    AFK: { emoji: "🚫", label: "離席中", style: ButtonStyle.Secondary },
    GAMING: { emoji: "🎮", label: "ゲーム中", style: ButtonStyle.Success },
    MEETING: { emoji: "👥", label: "会議中", style: ButtonStyle.Primary },
    WORKING: { emoji: "💻", label: "作業中", style: ButtonStyle.Primary },
};

client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(Config.discord_bot_token);

function createMemberList(voiceChannel) {
    return voiceChannel.members
        .map((member) => {
            const status = userStatus.get(member.id);
            const statusEmoji = status ? `${STATUS_TYPES[status].emoji} ` : "";
            return `・${statusEmoji} ${member.displayName}`;
        })
        .join("\n");
}

function createStatusButtons() {
    const row = new ActionRowBuilder();

    for (const [statusId, status] of Object.entries(STATUS_TYPES)) {
        const button = new ButtonBuilder()
            .setCustomId(`status_${statusId}`)
            .setLabel(status.label)
            .setEmoji(status.emoji)
            .setStyle(status.style);
        row.addComponents(button);
    }
    return row;
}

async function updateMessage(textChannel, voiceChannel) {
    if (voiceChannel.members.size === 0) {
        if (currentMessageId) {
            try {
                const oldMessage =
                    await textChannel.messages.fetch(currentMessageId);
                await oldMessage.delete();
                currentMessageId = null;
            } catch (error) {
                console.error("Failed to delete message:", error);
            }
        }
        return;
    }

    const memberList = createMemberList(voiceChannel);
    const embed = new EmbedBuilder()
        .setColor(0x006e54)
        .setTitle(`🔊 ${voiceChannel.name}`)
        .setDescription(memberList);

    const buttons = createStatusButtons();

    if (currentMessageId) {
        try {
            const oldMessage =
                await textChannel.messages.fetch(currentMessageId);
            await oldMessage.edit({ embeds: [embed], components: [buttons] });
        } catch (error) {
            console.error("Failed to edit message:", error);
            const newMessage = await textChannel.send({
                embeds: [embed],
                components: [buttons],
            });
            currentMessageId = newMessage.id;
        }
    } else {
        const newMessage = await textChannel.send({
            embeds: [embed],
            components: [buttons],
        });
        currentMessageId = newMessage.id;
    }
}

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const voiceChannel = newState.guild.channels.cache.get(
        Config.voice_channel_id,
    );
    if (!voiceChannel) return;

    const textChannel = newState.guild.channels.cache.get(
        Config.text_channel_id,
    );
    if (!textChannel) return;

    if (oldState.channelId !== newState.channelId) {
        if (!newState.channelId) {
            userStatus.delete(oldState.member.id);
        }
        await updateMessage(textChannel, voiceChannel);
    }
});

// Handle button interactions
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;

    const voiceChannel = interaction.guild.channels.cache.get(
        Config.voice_channel_id,
    );
    const textChannel = interaction.guild.channels.cache.get(
        Config.text_channel_id,
    );

    if (!voiceChannel || !textChannel) return;

    if (!voiceChannel.members.has(interaction.user.id)) {
        await interaction.reply({
            content:
                "ボイスチャンネルに参加している場合のみステータスを変更できます",
            ephemeral: true,
            fetchReply: true,
        });
        return;
    }

    const statusId = interaction.customId.replace("status_", "");

    if (statusId === "CLEAR") {
        userStatus.delete(interaction.user.id);
    } else {
        userStatus.set(interaction.user.id, statusId);
    }

    await updateMessage(textChannel, voiceChannel);
    await interaction.deferUpdate();
});

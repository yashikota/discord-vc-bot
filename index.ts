import * as fs from "node:fs";
import * as path from "node:path";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  type TextChannel,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";

interface ConfigType {
  discord_bot_token: string;
  text_channel_id: string;
  voice_channel_id: string;
}

const configPath = path.join(process.cwd(), "config.json");
const Config: ConfigType = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// Store the ID of the current message
let currentMessageId: string | null = null;
const userStatus = new Map<string, string>();

interface StatusType {
  emoji: string;
  label: string;
  style: ButtonStyle;
}

const STATUS_TYPES: Record<string, StatusType> = {
  AFK: { emoji: "🚫", label: "離席中", style: ButtonStyle.Secondary },
  GAMING: { emoji: "🎮", label: "ゲーム中", style: ButtonStyle.Success },
  MEETING: { emoji: "👥", label: "会議中", style: ButtonStyle.Primary },
  WORKING: { emoji: "💻", label: "作業中", style: ButtonStyle.Primary },
};

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.login(Config.discord_bot_token);

function createMemberList(voiceChannel: VoiceChannel): string {
  return voiceChannel.members
    .map((member) => {
      const status = userStatus.get(member.id);
      const statusEmoji = status ? `${STATUS_TYPES[status].emoji} ` : "";
      return `・${statusEmoji} ${member.displayName}`;
    })
    .join("\n");
}

function createStatusButtons(): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

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

async function updateMessage(
  textChannel: TextChannel,
  voiceChannel: VoiceChannel,
): Promise<void> {
  if (voiceChannel.members.size === 0) {
    if (currentMessageId) {
      try {
        const oldMessage = await textChannel.messages.fetch(currentMessageId);
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
      const oldMessage = await textChannel.messages.fetch(currentMessageId);
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

client.on(
  Events.VoiceStateUpdate,
  async (oldState: VoiceState, newState: VoiceState) => {
    const voiceChannel = newState.guild.channels.cache.get(
      Config.voice_channel_id,
    ) as VoiceChannel | undefined;
    if (!voiceChannel) return;

    const textChannel = newState.guild.channels.cache.get(
      Config.text_channel_id,
    ) as TextChannel | undefined;
    if (!textChannel) return;

    if (oldState.channelId !== newState.channelId) {
      if (!newState.channelId) {
        userStatus.delete(oldState.member?.id ?? "");
      }
      await updateMessage(textChannel, voiceChannel);
    }
  },
);

// Handle button interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const voiceChannel = interaction.guild?.channels.cache.get(
    Config.voice_channel_id,
  ) as VoiceChannel | undefined;
  const textChannel = interaction.guild?.channels.cache.get(
    Config.text_channel_id,
  ) as TextChannel | undefined;

  if (!voiceChannel || !textChannel) return;

  if (!voiceChannel.members.has(interaction.user.id)) {
    await interaction.reply({
      content: "ボイスチャンネルに参加している場合のみステータスを変更できます",
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

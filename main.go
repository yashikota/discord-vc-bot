package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	"github.com/bwmarrin/discordgo"
)

type Config struct {
	DiscordBotToken string `json:"discord_bot_token"`
	TextChannelID   string `json:"text_channel_id"`
	VoiceChannelID  string `json:"voice_channel_id"`
}

type StatusType struct {
	Emoji string
	Label string
	Style discordgo.ButtonStyle
}

var (
	config           Config
	currentMessageID string
	userStatus       = make(map[string]string)
	userStatusMu     sync.RWMutex
	statusTypes      = map[string]StatusType{
		"AFK":     {Emoji: "🚫", Label: "離席中", Style: discordgo.SecondaryButton},
		"GAMING":  {Emoji: "🎮", Label: "ゲーム中", Style: discordgo.SuccessButton},
		"MEETING": {Emoji: "👥", Label: "会議中", Style: discordgo.PrimaryButton},
		"WORKING": {Emoji: "💻", Label: "作業中", Style: discordgo.PrimaryButton},
	}
)

func main() {
	if err := loadConfig(); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	dg, err := discordgo.New("Bot " + config.DiscordBotToken)
	if err != nil {
		log.Fatalf("Failed to create Discord session: %v", err)
	}

	dg.AddHandler(ready)
	dg.AddHandler(voiceStateUpdate)
	dg.AddHandler(interactionCreate)

	dg.Identify.Intents = discordgo.IntentsGuilds | discordgo.IntentsGuildVoiceStates

	if err := dg.Open(); err != nil {
		log.Fatalf("Failed to open connection: %v", err)
	}
	defer dg.Close()

	fmt.Println("Bot is now running. Press CTRL+C to exit.")
	sc := make(chan os.Signal, 1)
	signal.Notify(sc, syscall.SIGINT, syscall.SIGTERM, os.Interrupt)
	<-sc
}

func loadConfig() error {
	data, err := os.ReadFile("config.json")
	if err != nil {
		return err
	}
	return json.Unmarshal(data, &config)
}

func ready(s *discordgo.Session, event *discordgo.Ready) {
	log.Printf("Ready! Logged in as %s", event.User.Username)
}

func voiceStateUpdate(s *discordgo.Session, vs *discordgo.VoiceStateUpdate) {
	if vs.BeforeUpdate != nil && vs.BeforeUpdate.ChannelID != vs.ChannelID {
		if vs.ChannelID == "" {
			userStatusMu.Lock()
			delete(userStatus, vs.UserID)
			userStatusMu.Unlock()
		}
		updateMessage(s, vs.GuildID)
	} else if vs.BeforeUpdate == nil {
		updateMessage(s, vs.GuildID)
	}
}

func interactionCreate(s *discordgo.Session, i *discordgo.InteractionCreate) {
	if i.Type != discordgo.InteractionMessageComponent {
		return
	}

	if !strings.HasPrefix(i.MessageComponentData().CustomID, "status_") {
		return
	}

	voiceChannel, err := s.State.Channel(config.VoiceChannelID)
	if err != nil {
		return
	}

	guild, err := s.State.Guild(i.GuildID)
	if err != nil {
		return
	}

	userInChannel := false
	for _, vs := range guild.VoiceStates {
		if vs.ChannelID == config.VoiceChannelID && vs.UserID == i.Member.User.ID {
			userInChannel = true
			break
		}
	}

	if !userInChannel {
		s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
			Type: discordgo.InteractionResponseChannelMessageWithSource,
			Data: &discordgo.InteractionResponseData{
				Content: "ボイスチャンネルに参加している場合のみステータスを変更できます",
				Flags:   discordgo.MessageFlagsEphemeral,
			},
		})
		return
	}

	statusID := strings.TrimPrefix(i.MessageComponentData().CustomID, "status_")

	userStatusMu.Lock()
	if statusID == "CLEAR" {
		delete(userStatus, i.Member.User.ID)
	} else {
		userStatus[i.Member.User.ID] = statusID
	}
	userStatusMu.Unlock()

	s.InteractionRespond(i.Interaction, &discordgo.InteractionResponse{
		Type: discordgo.InteractionResponseDeferredMessageUpdate,
	})

	updateMessage(s, i.GuildID)

	_ = voiceChannel
}

func updateMessage(s *discordgo.Session, guildID string) {
	guild, err := s.State.Guild(guildID)
	if err != nil {
		log.Printf("Failed to get guild: %v", err)
		return
	}

	var members []*discordgo.Member
	for _, vs := range guild.VoiceStates {
		if vs.ChannelID == config.VoiceChannelID {
			member, err := s.GuildMember(guildID, vs.UserID)
			if err != nil {
				continue
			}
			members = append(members, member)
		}
	}

	if len(members) == 0 {
		if currentMessageID != "" {
			s.ChannelMessageDelete(config.TextChannelID, currentMessageID)
			currentMessageID = ""
		}
		return
	}

	voiceChannel, err := s.State.Channel(config.VoiceChannelID)
	if err != nil {
		log.Printf("Failed to get voice channel: %v", err)
		return
	}

	memberList := createMemberList(members)
	embed := &discordgo.MessageEmbed{
		Title:       fmt.Sprintf("🔊 %s", voiceChannel.Name),
		Description: memberList,
		Color:       0x006e54,
	}

	buttons := createStatusButtons()

	if currentMessageID != "" {
		_, err := s.ChannelMessageEditComplex(&discordgo.MessageEdit{
			Channel:    config.TextChannelID,
			ID:         currentMessageID,
			Embeds:     &[]*discordgo.MessageEmbed{embed},
			Components: &buttons,
		})
		if err != nil {
			msg, err := s.ChannelMessageSendComplex(config.TextChannelID, &discordgo.MessageSend{
				Embeds:     []*discordgo.MessageEmbed{embed},
				Components: buttons,
			})
			if err == nil {
				currentMessageID = msg.ID
			}
		}
	} else {
		msg, err := s.ChannelMessageSendComplex(config.TextChannelID, &discordgo.MessageSend{
			Embeds:     []*discordgo.MessageEmbed{embed},
			Components: buttons,
		})
		if err == nil {
			currentMessageID = msg.ID
		}
	}
}

func createMemberList(members []*discordgo.Member) string {
	var lines []string
	userStatusMu.RLock()
	defer userStatusMu.RUnlock()

	for _, member := range members {
		displayName := member.Nick
		if displayName == "" {
			displayName = member.User.Username
		}

		status, ok := userStatus[member.User.ID]
		if ok {
			st := statusTypes[status]
			lines = append(lines, fmt.Sprintf("・%s %s", st.Emoji, displayName))
		} else {
			lines = append(lines, fmt.Sprintf("・ %s", displayName))
		}
	}
	return strings.Join(lines, "\n")
}

func createStatusButtons() []discordgo.MessageComponent {
	var buttons []discordgo.MessageComponent

	buttonOrder := []string{"AFK", "GAMING", "MEETING", "WORKING"}
	for _, statusID := range buttonOrder {
		st := statusTypes[statusID]
		buttons = append(buttons, discordgo.Button{
			Label:    st.Label,
			Style:    st.Style,
			CustomID: "status_" + statusID,
			Emoji: &discordgo.ComponentEmoji{
				Name: st.Emoji,
			},
		})
	}

	return []discordgo.MessageComponent{
		discordgo.ActionsRow{
			Components: buttons,
		},
	}
}

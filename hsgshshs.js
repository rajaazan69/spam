const {
    Events,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionsBitField,
    ThreadAutoArchiveDuration
} = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const { 
    guildId, backupServerId, backupServerInviteLink, roles, mmTiers, prefix,
    transcriptLogChannelId, leaderboardChannelId, serverModLogChannelId,
    traderLeaderboardChannelId 
} = require('../config.json'); 
const { loadDB, saveDB } = require('../utils/db'); 
const { updateLeaderboard } = require('../utils/leaderboardManager');
const { updateTraderLeaderboard, updateTraderTopRole } = require('../utils/traderLeaderboardManager');
const { sendServerModLog } = require('../utils/logger');


function getRoleMentionsAndKeys(interaction, tierKey) {
    const tier = mmTiers[tierKey];
    if (!tier || !tier.pingRoles) return { mentions: '', keys: [] };
    const mentions = [];
    const keys = [];
    tier.pingRoles.forEach(roleKey => {
        const roleId = roles[roleKey]; 
        if (roleId) {
            mentions.push(`<@&${roleId}>`);
            keys.push(roleKey); 
        }
    });
    return { mentions: mentions.join(' '), keys: keys };
}


async function parseUsersFromTicketEmbed(ticketChannel, client) {
    let ticketCreator = null;
    let otherTrader = null;
    try {
        const messages = await ticketChannel.messages.fetch({ limit: 15, after: 0 });
        const botMessage = messages.find(m => m.author.id === client.user.id && m.embeds[0]?.title === 'Middleman Request');
        
        if (botMessage) {
            const embed = botMessage.embeds[0];
            const creatorMatch = embed.description.match(/Trader 1:.*?<@!?(\d{17,19})>/);
            const traderMatch = embed.description.match(/Trader 2:.*?<@!?(\d{17,19})>/);
            if (creatorMatch && creatorMatch[1]) ticketCreator = creatorMatch[1];
            if (traderMatch && traderMatch[1]) otherTrader = traderMatch[1];
        }
    } catch (err) { console.error("[ParseUsersFromTicket - InteractionCreate] Error:", err.message); }
    return { ticketOwnerId: ticketCreator, otherTraderId: otherTrader };
}


async function sendTranscriptFallback(ticketChannel, logChannel, transcriptFilename, client) {
    try {
        
        const fileAttachment = await discordTranscripts.createTranscript(ticketChannel, {
            limit: -1,
            returnType: 'buffer',
            filename: transcriptFilename,
            saveImages: true,
            poweredBy: false
        });
        const infoEmbed = new EmbedBuilder()
            .setColor('#000000')
            .setTitle(`${ticketChannel.name} - Transcript (fallback)`)
            .setDescription('Ã¢ÂÂ Ã¯Â¸Â The transcript file was too large to upload to Discord with d4l.info viewer. Here is the raw HTML transcript attached below.\n\nYou may open it in your browser manually.')
            .setTimestamp();
        await logChannel.send({
            embeds: [infoEmbed],
            files: [{ attachment: fileAttachment, name: transcriptFilename }]
        });
        return true;
    } catch (err) {
        console.error('[Transcript Fallback] Error creating fallback transcript:', err);
        await logChannel.send({
            content: 'Ã¢ÂÂ Transcript could not be attached due to file size or an error.',
        });
        return false;
    }
}


async function hasOpenTicket(userId, guild, timeoutMs = 2000) {
    return new Promise(async (resolve) => {
        const timeout = setTimeout(() => {
            console.warn(`[HasOpenTicket] Timeout checking tickets for user ${userId}, allowing ticket creation`);
            resolve({ hasTicket: false, ticketChannel: null });
        }, timeoutMs);

        try {
            console.log(`[HasOpenTicket] Checking for open tickets for user ${userId}...`);
            
            
            const activeThreads = await guild.channels.fetchActiveThreads();
            
            
            for (const [threadId, thread] of activeThreads.threads) {
                try {
                
                    if (thread.type !== ChannelType.PrivateThread) {
                        continue;
                    }
                    
                    
                    let isUserInThread = false;
                    
                    
                    if (thread.members.cache.has(userId)) {
                        isUserInThread = true;
                    } else {
                        
                        try {
                            const threadMember = await thread.members.fetch(userId).catch(() => null);
                            if (threadMember) {
                                isUserInThread = true;
                            }
                        } catch (error) {
                            
                            continue;
                        }
                    }
                    
                  
                    if (isUserInThread) {
                        console.log(`[HasOpenTicket] User ${userId} found in thread ${thread.name}, checking if they're a trader...`);
                        
                       
                        try {
                            const messages = await thread.messages.fetch({ limit: 15, after: 0 });
                            const botMessage = messages.find(m => 
                                m.author.bot && 
                                m.embeds[0]?.title === 'Middleman Request'
                            );
                            
                            if (botMessage && botMessage.embeds[0]) {
                                const embed = botMessage.embeds[0];
                                const description = embed.description || '';
                                
                                
                                const trader1Match = description.match(/Trader 1:.*?<@!?(\d{17,19})>/);
                                const trader2Match = description.match(/Trader 2:.*?<@!?(\d{17,19})>/);
                                
                                const trader1Id = trader1Match ? trader1Match[1] : null;
                                const trader2Id = trader2Match ? trader2Match[1] : null;
                                
                                console.log(`[HasOpenTicket] Thread ${thread.name} - Trader 1: ${trader1Id}, Trader 2: ${trader2Id}, Checking user: ${userId}`);
                                
                              
                                if (userId === trader1Id || userId === trader2Id) {
                                    clearTimeout(timeout);
                                    console.log(`[HasOpenTicket] User ${userId} IS a trader in ticket: ${thread.name} (${thread.id})`);
                                    resolve({ hasTicket: true, ticketChannel: thread });
                                    return;
                                } else {
                                    console.log(`[HasOpenTicket] User ${userId} is in thread ${thread.name} but is NOT a trader (probably staff)`);
                                    
                                }
                            } else {
                                console.log(`[HasOpenTicket] Could not find ticket embed in thread ${thread.name}, skipping...`);
                                
                            }
                        } catch (messageError) {
                            console.warn(`[HasOpenTicket] Error reading messages in thread ${thread.name}: ${messageError.message}`);
                           
                            clearTimeout(timeout);
                            console.log(`[HasOpenTicket] Could not verify trader status for user ${userId} in ${thread.name}, assuming they are a trader`);
                            resolve({ hasTicket: true, ticketChannel: thread });
                            return;
                        }
                    }
                } catch (error) {
                    console.warn(`[HasOpenTicket] Error checking thread ${thread.name}: ${error.message}`);
                    continue;
                }
            }
            
            
            const db = guild.client.db || loadDB();
            if (db.activeTickets) {
                for (const [ticketId, ticketData] of Object.entries(db.activeTickets)) {
                    
                    if (ticketData.ticketCreatorId === userId || ticketData.otherTraderId === userId) {
                       
                        try {
                            const thread = await guild.channels.fetch(ticketId).catch(() => null);
                            if (thread && thread.isThread()) {
                                
                                const threadMember = await thread.members.fetch(userId).catch(() => null);
                                if (threadMember) {
                                    clearTimeout(timeout);
                                    console.log(`[HasOpenTicket] User ${userId} found as trader in DB-tracked ticket: ${thread.name} (${thread.id})`);
                                    resolve({ hasTicket: true, ticketChannel: thread });
                                    return;
                                }
                            } else {
                                
                                delete db.activeTickets[ticketId];
                                saveDB(db);
                                console.log(`[HasOpenTicket] Cleaned up non-existent ticket ${ticketId} from database`);
                            }
                        } catch (error) {
                            console.warn(`[HasOpenTicket] Error checking DB ticket ${ticketId}: ${error.message}`);
                        }
                    }
                }
            }
            
            clearTimeout(timeout);
            console.log(`[HasOpenTicket] No open tickets found for trader ${userId}`);
            resolve({ hasTicket: false, ticketChannel: null });
            
        } catch (error) {
            clearTimeout(timeout);
            console.error('[HasOpenTicket] Error checking for open tickets:', error);
            
            resolve({ hasTicket: false, ticketChannel: null });
        }
    });
}


async function findUserByInput(input, guild) {
    input = input.trim();
    
   
    if (/^\d{17,19}$/.test(input)) {
        try {
            const user = await guild.client.users.fetch(input);
            return user;
        } catch (error) {
            console.log(`[FindUser] Could not fetch user by ID: ${input}`);
        }
    }
    
    
    const mentionMatch = input.match(/^<@!?(\d{17,19})>$/);
    if (mentionMatch) {
        try {
            const user = await guild.client.users.fetch(mentionMatch[1]);
            return user;
        } catch (error) {
            console.log(`[FindUser] Could not fetch user by mention: ${input}`);
        }
    }
    
    
    if (input.includes('#')) {
        const [username, discriminator] = input.split('#');
        if (discriminator && discriminator.length === 4 && /^\d{4}$/.test(discriminator)) {
            try {
                const members = await guild.members.fetch();
                const foundMember = members.find(member => 
                    member.user.username.toLowerCase() === username.toLowerCase() && 
                    member.user.discriminator === discriminator
                );
                if (foundMember) return foundMember.user;
            } catch (error) {
                console.log(`[FindUser] Error searching by username#discriminator: ${error.message}`);
            }
        }
    }
    
   
    try {
        const members = await guild.members.fetch();
        
       
        let foundMember = members.find(member => 
            member.displayName.toLowerCase() === input.toLowerCase()
        );
        
        if (foundMember) return foundMember.user;
        
       
        foundMember = members.find(member => 
            member.user.username.toLowerCase() === input.toLowerCase()
        );
        
        if (foundMember) return foundMember.user;
        
        
        foundMember = members.find(member => 
            member.displayName.toLowerCase().includes(input.toLowerCase())
        );
        
        if (foundMember) return foundMember.user;
        
       
        foundMember = members.find(member => 
            member.user.username.toLowerCase().includes(input.toLowerCase())
        );
        
        if (foundMember) return foundMember.user;
        
    } catch (error) {
        console.log(`[FindUser] Error searching guild members: ${error.message}`);
    }
    
    return null;
}


async function safeReply(interaction, options) {
    try {
        if (interaction.replied) {
            return await interaction.followUp(options);
        } else if (interaction.deferred) {
            return await interaction.editReply(options);
        } else {
            return await interaction.reply(options);
        }
    } catch (error) {
        if (error.code === 10062) {
            console.warn(`[SafeReply] Interaction expired for ${interaction.user?.tag || 'unknown user'}`);
            return null;
        }
        throw error;
    }
}


async function safeUpdate(interaction, options) {
    try {
        return await interaction.update(options);
    } catch (error) {
        if (error.code === 10062) {
            console.warn(`[SafeUpdate] Interaction expired for ${interaction.user?.tag || 'unknown user'}`);
            return null;
        }
        throw error;
    }
}

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        
        if (!interaction.guild && !interaction.isModalSubmit() && !interaction.isButton()) { 
            if (interaction.isCommand() || interaction.isAutocomplete()) { return; }
        }

       
        if (interaction.isChatInputCommand()) {
            if (!interaction.guild) { return safeReply(interaction, { content: "Slash commands can only be used in a server.", ephemeral: true}); } 
            const command = client.commands.get(interaction.commandName); 
            if (!command) { 
                console.error(`[InteractionCreate] No command matching ${interaction.commandName} was found.`); 
                return safeReply(interaction, { content: `Error: The command "${interaction.commandName}" was not found.`, ephemeral: true }); 
            } 
            try { 
                await command.execute(interaction, client); 
            } catch (error) { 
                console.error(`[InteractionCreate] Error executing slash command ${interaction.commandName}:`, error); 
                await safeReply(interaction, { content: 'There was an error while executing this command! Check console.', ephemeral: true }); 
            }
            return;
        }
        
        const currentDB = client.db || loadDB(); 

        if (interaction.guild) { 
            const userMMBan = currentDB.mmBans.find(ban => ban.userId === interaction.user.id);
            if (userMMBan && (interaction.isButton() || interaction.isStringSelectMenu())) {
                if (interaction.customId === 'request_middleman_button' || interaction.customId === 'mm_tier_select' || interaction.customId.startsWith('show_mm_modal_')) {
                    return safeReply(interaction, { content: `You are currently banned from requesting a middleman. Reason: ${userMMBan.reason}`, ephemeral: true });
                }
            }
        }

      
        if (interaction.isButton()) {
            console.log(`[InteractionCreate] Button clicked: ${interaction.customId} by ${interaction.user.tag} (${interaction.user.id})`);
            
            if (interaction.customId === 'request_middleman_button') {
                if (!interaction.guild) return;
                
                
                const selectMenu = new StringSelectMenuBuilder().setCustomId('mm_tier_select').setPlaceholder('Select Trade Value').addOptions(Object.entries(mmTiers).map(([key, tier]) => new StringSelectMenuOptionBuilder().setLabel(tier.name).setValue(tier.value))); 
                const row = new ActionRowBuilder().addComponents(selectMenu); 
                
                const replyResult = await safeReply(interaction, { content: `${interaction.user} Select your middleman for your trade value:`, components: [row], ephemeral: true });
                if (!replyResult) return; 
                
                
                const ticketCheck = await hasOpenTicket(interaction.user.id, interaction.guild);
                if (ticketCheck.hasTicket) {
                    try {
                        await interaction.editReply({ 
                            content: `Ã¢ÂÂ You already have an open ticket: ${ticketCheck.ticketChannel}. Please close your current ticket before creating a new one.`, 
                            components: []
                        });
                    } catch (error) {
                        if (error.code !== 10062) console.error('[InteractionCreate] Error editing reply:', error);
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('show_mm_modal_')) {
                 if (!interaction.guild) return; 
                 
                 const selectedTierValue = interaction.customId.replace('show_mm_modal_', ''); 
                 const selectedTierKey = Object.keys(mmTiers).find(key => mmTiers[key].value === selectedTierValue); 
                 if (!selectedTierKey) { 
                    console.error(`[InteractionCreate] Invalid tier value '${selectedTierValue}' from button ID.`); 
                    return safeUpdate(interaction, { content: 'Error retrieving middleman selection information. Please try selecting the tier again.', components: [] }); 
                 } 
                 
                
                 const ticketCheck = await hasOpenTicket(interaction.user.id, interaction.guild, 1000);
                 if (ticketCheck.hasTicket) {
                     return safeUpdate(interaction, { 
                         content: `Ã¢ÂÂ You already have an open ticket: ${ticketCheck.ticketChannel}. Please close your current ticket before creating a new one.`, 
                         components: [] 
                     });
                 }
                 
                 const maxTitleLength = 45; 
                 const titlePrefix = "MM Request: "; 
                 const tierName = mmTiers[selectedTierKey].name; 
                 let modalTitle = titlePrefix + tierName; 
                 if (modalTitle.length > maxTitleLength) { 
                    const availableLength = maxTitleLength - titlePrefix.length - 3; 
                    modalTitle = titlePrefix + tierName.substring(0, availableLength > 0 ? availableLength : 0) + "..."; 
                 } 
                 const modal = new ModalBuilder().setCustomId(`mm_request_modal_${selectedTierValue}`).setTitle(modalTitle); 
                 const traderIdInput = new TextInputBuilder().setCustomId('trader_id_input').setLabel("OTHER TRADER (ID/Username):").setStyle(TextInputStyle.Short).setPlaceholder('Enter ID, @mention, username, or display name').setRequired(true);
                 const yourTradeInput = new TextInputBuilder().setCustomId('your_trade_input').setLabel('What is YOUR trade? (Be specific)').setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g., My FR Frost Dragon (Adopt Me)').setRequired(true);
                 const otherTraderTradeInput = new TextInputBuilder().setCustomId('other_trader_trade_input').setLabel("What is your OTHER TRADER'S trade?").setStyle(TextInputStyle.Paragraph).setPlaceholder('e.g., Their $50 PayPal F&F').setRequired(true);
                 modal.addComponents(new ActionRowBuilder().addComponents(traderIdInput), new ActionRowBuilder().addComponents(yourTradeInput), new ActionRowBuilder().addComponents(otherTraderTradeInput)); 
                 
                 try {
                     await interaction.showModal(modal);
                 } catch (error) {
                     if (error.code === 10062) {
                         console.warn(`[InteractionCreate] Modal interaction expired for ${interaction.user.tag}`);
                         return;
                     }
                     throw error;
                 }
                 return;
            }
            if (interaction.customId.startsWith('claim_ticket_')) {
    if (!interaction.guild) return;

    // Ensure interaction.member exists
    let member = interaction.member;
    if (!member) {
        member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member) return safeReply(interaction, { content: 'Could not fetch your member info.', ephemeral: true });
    }

    // Fetch ticket channel safely
    let ticketChannel;
    try {
        ticketChannel = await interaction.client.channels.fetch(interaction.channelId);
    } catch (err) {
        console.error("❌ Failed to fetch ticketChannel:", err);
        return safeReply(interaction, { content: "⚠️ Could not find this ticket channel. Please try again.", ephemeral: true });
    }
    if (!ticketChannel || !('isThread' in ticketChannel) || !ticketChannel.isThread()) {
        return safeReply(interaction, { content: 'This is not a ticket thread.', ephemeral: true });
    }

    // Fetch ticket data
    client.db.activeTickets = client.db.activeTickets || {};
    const ticketData = client.db.activeTickets[ticketChannel.id];
    if (!ticketData) return safeReply(interaction, { content: 'Ticket data not found.', ephemeral: true });

    if (ticketData.middlemanId) {
        return safeReply(interaction, { content: `🔒 This ticket is already claimed by <@${ticketData.middlemanId}>.`, ephemeral: true });
    }

    // Assign middleman
    ticketData.middlemanId = interaction.user.id;
    ticketData.claimedBy = interaction.user.id;
    saveDB(client.db);

    // Rename thread
    await ticketChannel.setName(interaction.user.username).catch(() => null);

    // Confirmation embed
    const mmConfirmEmbed = new EmbedBuilder()
        .setColor('#000000')
        .setTitle('**| Middleman Assigned**')
        .setDescription(`**${interaction.user.tag}** is now your middleman.`)
        .addFields(
            { name: 'Username', value: interaction.user.username, inline: true },
            { name: 'Discord ID', value: interaction.user.id, inline: true }
        )
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

    await ticketChannel.send({ embeds: [mmConfirmEmbed] });

    // Restrict thread permissions: only two traders + middleman can type
    const allowedUsers = [
        ticketData.ticketCreatorId,
        ticketData.otherTraderId,
        interaction.user.id
    ];

    await ticketChannel.members.fetch();

    // Remove all members who are not allowed
    for (const [memberId, threadMember] of ticketChannel.members.cache) {
        if (!allowedUsers.includes(memberId) && !threadMember.user.bot) {
            await ticketChannel.members.remove(memberId, 'Restrict typing to traders + MM').catch(() => null);
        }
    }

    // Ensure allowed users are added as members
    for (const userId of allowedUsers) {
        await ticketChannel.members.add(userId).catch(() => null);
    }

    await safeReply(interaction, { content: '✅ You have claimed this ticket! Only you and the two traders can type here now.', ephemeral: true });
    return;
}
            

            if (interaction.customId.startsWith('provide_feedback_')) {
                console.log(`[FeedbackButton] Clicked by ${interaction.user.tag}. Custom ID: ${interaction.customId}`); 
                try { 
                    const parts = interaction.customId.split('_'); 
                    const ticketIdForFeedback = parts[2]; 
                    const mmUserIdForFeedback = parts[3]; 
                    const feedbackModal = new ModalBuilder().setCustomId(`submit_feedback_${ticketIdForFeedback}_${mmUserIdForFeedback}`).setTitle('Middleman Feedback'); 
                    const ratingInput = new TextInputBuilder().setCustomId('feedback_rating').setLabel('Rate experience (e.g., 1-5, Good, Bad)').setStyle(TextInputStyle.Short).setPlaceholder('e.g., 5/5, Excellent, or a brief rating').setRequired(true); 
                    const commentsInput = new TextInputBuilder().setCustomId('feedback_comments').setLabel('Additional comments about your experience?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Any specific details you\'d like to share?').setRequired(false); 
                    const improvementInput = new TextInputBuilder().setCustomId('feedback_improvement').setLabel('How can our middleman service improve?').setStyle(TextInputStyle.Paragraph).setPlaceholder('Any suggestions for us?').setRequired(false); 
                    feedbackModal.addComponents( new ActionRowBuilder().addComponents(ratingInput), new ActionRowBuilder().addComponents(commentsInput), new ActionRowBuilder().addComponents(improvementInput) ); 
                    await interaction.showModal(feedbackModal); 
                    console.log(`[FeedbackButton] Modal shown for ticket ${ticketIdForFeedback}, MM ${mmUserIdForFeedback}.`); 
                } catch (error) { 
                    console.error(`[FeedbackButton] Error showing modal:`, error); 
                    if (error.code !== 10062) {
                        await safeReply(interaction, { content: 'Sorry, an error occurred while trying to open the feedback form.', ephemeral: true }); 
                    }
                } 
                return; 
            }

            
            if (interaction.customId.startsWith('close_ticket_')) {
                if (!interaction.guild) return; 
                const ticketChannel = interaction.channel; 
                if (!ticketChannel.isThread()) { return safeReply(interaction, { content: 'This action can only be performed in a ticket.', ephemeral: true }); } 
                if (!interaction.member) { try { await interaction.guild.members.fetch(interaction.user.id); } catch (fetchErr) { console.error(`[CloseButton] Failed to fetch member ${interaction.user.tag}:`, fetchErr); return safeReply(interaction, { content: 'Could not verify permissions.', ephemeral: true });}} 
                
                const memberClosing = interaction.member; 
                const canManageThreads = memberClosing.permissions.has(PermissionsBitField.Flags.ManageThreads); 
                const hasStaffRole = roles.staffRoles && roles.staffRoles.some(roleId => memberClosing.roles.cache.has(roleId)); 
                
                if (!canManageThreads && !hasStaffRole) { return safeReply(interaction, { content: 'You do not have permission to close this ticket.', ephemeral: true });}
                
                try {
                    await interaction.deferUpdate();
                } catch (error) {
                    if (error.code === 10062) {
                        console.warn(`[CloseTicket] Interaction expired for ${interaction.user.tag}`);
                        return;
                    }
                    throw error;
                }
                
                try {
                    
                    const logChannelForTranscripts = transcriptLogChannelId ? await client.channels.fetch(transcriptLogChannelId).catch(() => null) : null;
                    const transcriptFilename = `closed-${ticketChannel.name.toLowerCase().replace(/[^a-z0-9]/gi, '_')}.html`;

                    if (logChannelForTranscripts) {
                        try {
                            
                            const fileAttachment = await discordTranscripts.createTranscript(ticketChannel, {
                                limit: -1,
                                returnType: 'attachment',
                                filename: transcriptFilename,
                                saveImages: true,
                                poweredBy: false
                            });
                            const { ticketOwnerId, otherTraderId } = await parseUsersFromTicketEmbed(ticketChannel, client);
                            const transcriptInfoEmbed = new EmbedBuilder()
                                .setColor('#000000')
                                .setTitle(`${ticketChannel.name} - Transcript`)
                                .addFields(
                                    { name: 'Ticket Owner', value: ticketOwnerId ? `<@${ticketOwnerId}> (\`${ticketOwnerId}\`)` : 'Unknown', inline: true },
                                    { name: 'Ticket ID', value: `\`${ticketChannel.id}\``, inline: true },
                                    { name: 'Closed By', value: `${memberClosing.user.tag} (<@${memberClosing.id}>)`, inline: true }
                                )
                                .setTimestamp()
                                .setFooter({ text: "Transcript file attached below." });

                            
                            let logMessageSentWithFile = null;
                            try {
                                logMessageSentWithFile = await logChannelForTranscripts.send({
                                    embeds: [transcriptInfoEmbed],
                                    files: [fileAttachment]
                                });
                            } catch (err) {
                                
                                if (err.code === 50035 || err.message?.includes("File size") || err.message?.includes("file is larger than")) {
                                    logMessageSentWithFile = null;
                                } else {
                                    throw err;
                                }
                            }

                            if (logMessageSentWithFile && logMessageSentWithFile.attachments.size > 0) {
                                const attachmentURL = logMessageSentWithFile.attachments.first().url;
                                const transcriptUrl = `https://d4l.info/chat-exporter?url=${attachmentURL || "#"}`;
                                const viewButton = new ButtonBuilder()
                                    .setLabel(transcriptFilename)
                                    .setURL(transcriptUrl)
                                    .setStyle(ButtonStyle.Link);
                                const buttonRow = new ActionRowBuilder().addComponents(viewButton);
                                await logMessageSentWithFile.edit({ components: [buttonRow] });
                            } else {
                                
                                await sendTranscriptFallback(ticketChannel, logChannelForTranscripts, transcriptFilename, client);
                            }
                        } catch (err) {
                            
                            console.warn("[InteractionCreate CloseTicket - Transcript] Attachment or link failed, using fallback. Error:", err);
                            await sendTranscriptFallback(ticketChannel, logChannelForTranscripts, transcriptFilename, client);
                        }
                    } else {
                        console.warn(`[InteractionCreate CloseTicket - Transcript] transcriptLogChannelId not configured or channel not found.`);
                    }

                    
                    const { ticketOwnerId, otherTraderId } = await parseUsersFromTicketEmbed(ticketChannel, client);
                    let tradersUpdated = false;
                    
                    if (ticketOwnerId) {
                        client.db.traderLeaderboard = client.db.traderLeaderboard || {};
                        client.db.traderLeaderboard[ticketOwnerId] = (client.db.traderLeaderboard[ticketOwnerId] || 0) + 1;
                        tradersUpdated = true;
                        console.log(`[TraderLeaderboard] Added point to ticket owner ${ticketOwnerId} on ticket close`);
                    }
                    if (otherTraderId && otherTraderId !== ticketOwnerId) {
                        client.db.traderLeaderboard = client.db.traderLeaderboard || {};
                        client.db.traderLeaderboard[otherTraderId] = (client.db.traderLeaderboard[otherTraderId] || 0) + 1;
                        tradersUpdated = true;
                        console.log(`[TraderLeaderboard] Added point to other trader ${otherTraderId} on ticket close`);
                    }
                    
                    
                    if (tradersUpdated) {
                        try {
                            await updateTraderLeaderboard(client);
                            await updateTraderTopRole(client, interaction.guild);
                            console.log(`[TraderLeaderboard] Updated leaderboard and roles after ticket close`);
                        } catch (error) {
                            console.error(`[TraderLeaderboard] Error updating trader system:`, error);
                        }
                    }

                    
                    const staffRoleIdsForRemoval = roles.staffRoles || []; 
                    if (ticketChannel.members) { 
                        await ticketChannel.members.fetch(); 
                        for (const [memberId, threadMember] of ticketChannel.members.cache) { 
                            const member = await ticketChannel.guild.members.fetch(memberId).catch(() => null); 
                            if (member && !member.user.bot && !member.roles.cache.some(role => staffRoleIdsForRemoval.includes(role.id))) { 
                                try { await ticketChannel.members.remove(memberId, 'Ticket closed'); } 
                                catch (err) { console.error(`Failed to remove ${member.user.tag} from ticket ${ticketChannel.name}:`, err); }
                            }
                        }
                    } 

                    const finishedButton = new ButtonBuilder()
                        .setCustomId(`finish_log_ticket_${ticketChannel.id}_${interaction.user.id}`)
                        .setLabel('Log MM Point & Delete')
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'');
                    const reopenButton = new ButtonBuilder()
                        .setCustomId(`final_reopen_ticket_${ticketChannel.id}`)
                        .setLabel('Reopen')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('♻️');
                    const deleteButton = new ButtonBuilder()
                        .setCustomId(`final_delete_ticket_${ticketChannel.id}`)
                        .setLabel('Delete Only')
                        .setStyle(ButtonStyle.Danger)
                        .setEmoji('❌');
                        
                    const closedButtonsRow = new ActionRowBuilder().addComponents(finishedButton, reopenButton, deleteButton);
                    
                    const closedEmbedInTicket = new EmbedBuilder()
                        .setColor('#000000')
                        .setTitle('Ticket Closed & Transcripted')
                        .setDescription(`Ticket closed by ${interaction.user}.\n\nÃ°ÂÂÂ **Transcript saved automatically**\nÃ°ÂÂÂ **Trader points awarded**`)
                        .addFields(
                           { name: 'â Log MM Point & Delete', value: 'Award MM point to staff and delete ticket.', inline: true },
                           { name: 'Ã°ÂÂÂ Reopen', value: 'Reopen the ticket for users.', inline: true },
                           { name: 'Ã¢ÂÂ Delete Only', value: 'Delete ticket without MM points.', inline: true }
                        )
                        .setTimestamp(); 
                    
                    await ticketChannel.send({ embeds: [closedEmbedInTicket], components: [closedButtonsRow] });

                    
                    if (client.db.activeTickets && client.db.activeTickets[ticketChannel.id]) {
                        delete client.db.activeTickets[ticketChannel.id];
                        console.log(`[ActiveTickets] Ticket ${ticketChannel.id} removed from active tracking upon closing.`);
                    }

                    saveDB(client.db);

                } catch (error) { 
                    console.error('Error during ticket close:', error); 
                    try {
                        await interaction.followUp({ content: 'â There was an error closing the ticket. Please check the console.', ephemeral: true });
                    } catch (followUpError) {
                        if (followUpError.code !== 10062) {
                            console.error('Error sending followup:', followUpError);
                        }
                    }
                }
                return;
            }

            
            if (interaction.customId && interaction.customId.startsWith('finish_log_ticket_')) {
                if (!interaction.guild) return;
                const ticketChannel = interaction.channel;
                if (!ticketChannel.isThread()) return safeReply(interaction, { content: 'This is not a ticket thread.', ephemeral: true });

                const canManageThreads = interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads);
                const hasStaffRole = roles.staffRoles && roles.staffRoles.some(roleId => interaction.member.roles.cache.has(roleId));
                if (!canManageThreads && !hasStaffRole) {
                    return safeReply(interaction, { content: 'You do not have permission to complete this action.', ephemeral: true });
                }

                try {
                    await interaction.deferReply({ ephemeral: true });
                } catch (error) {
                    if (error.code === 10062) {
                        console.warn(`[FinishTicket] Interaction expired for ${interaction.user.tag}`);
                        return;
                    }
                    throw error;
                }

                try {
                    const parts = interaction.customId.split('_');
                    const ticketId = parts[3];
                    const closerId = parts[4];

                    const closerMember = await interaction.guild.members.fetch(closerId).catch(() => null);

                    
                    if (closerMember) {
                        const isEligibleForPoints = roles.staffRoles && roles.staffRoles.some(roleId => closerMember.roles.cache.has(roleId));
                        if (isEligibleForPoints) {
                            client.db.mmLeaderboard = client.db.mmLeaderboard || {};
                            const currentPoints = client.db.mmLeaderboard[closerId] || 0;
                            client.db.mmLeaderboard[closerId] = currentPoints + 1;
                            if (leaderboardChannelId) { updateLeaderboard(client); }
                            console.log(`[Leaderboard] User ${closerMember.user.tag} (Finished Button) has been awarded a MM point.`);
                        } else {
                            console.log(`[Leaderboard] User ${closerMember.user.tag} (Finished Button) was NOT eligible for MM points.`);
                        }
                    }

                 
                    const { ticketOwnerId, otherTraderId } = await parseUsersFromTicketEmbed(ticketChannel, client);
                    const feedbackButton = new ButtonBuilder().setCustomId(`provide_feedback_${ticketChannel.id}_${closerMember ? closerMember.id : 'none'}`).setLabel('Provide Feedback').setStyle(ButtonStyle.Primary);
                    const feedbackRow = new ActionRowBuilder().addComponents(feedbackButton);
                    const feedbackDmEmbed = new EmbedBuilder().setColor('#000000').setTitle('Ticket Closed - Feedback Request').setDescription(`Your ticket \`${ticketChannel.name}\` ${closerMember ? `handled by **${closerMember.user.tag}** ` : ''}has been closed.\n\nWe'd appreciate your feedback on your experience! Click the button below to share your thoughts.`).setTimestamp();
                    if (ticketOwnerId) { const owner = await client.users.fetch(ticketOwnerId).catch(() => null); if (owner) await owner.send({ embeds: [feedbackDmEmbed], components: [feedbackRow] }).catch(e => console.warn(`Failed to DM feedback to ticket owner ${owner.tag}: ${e.message}`)); }
                    if (otherTraderId && otherTraderId !== ticketOwnerId) { const trader = await client.users.fetch(otherTraderId).catch(() => null); if (trader) await trader.send({ embeds: [feedbackDmEmbed], components: [feedbackRow] }).catch(e => console.warn(`Failed to DM feedback to other trader ${trader.tag}: ${e.message}`)); }

                    saveDB(client.db);
                    
                    await interaction.editReply({ content: 'â MM point logged, feedback sent. Deleting ticket now...' });

                    setTimeout(() => ticketChannel.delete(`Ticket finished by ${interaction.user.tag}.`), 2000);

                } catch (error) {
                    console.error('Error finishing ticket:', error);
                    try {
                        await interaction.editReply({ content: 'â An error occurred while finishing the ticket. Check the console.' });
                    } catch (editError) {
                        if (editError.code !== 10062) {
                            console.error('Error editing reply:', editError);
                        }
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('final_reopen_ticket_')) {
                if (!interaction.guild) return;
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads)) {
                    return safeReply(interaction, { content: 'You do not have permission to reopen tickets.', ephemeral: true });
                }
                const ticketChannel = interaction.channel;
                if (!ticketChannel.isThread()) { return safeReply(interaction, { content: 'This action can only be performed in a ticket thread.', ephemeral: true });}
                
                try {
                    await interaction.deferUpdate();
                } catch (error) {
                    if (error.code === 10062) {
                        console.warn(`[ReopenTicket] Interaction expired for ${interaction.user.tag}`);
                        return;
                    }
                    throw error;
                }

                const { ticketOwnerId, otherTraderId } = await parseUsersFromTicketEmbed(ticketChannel, client);
                if (ticketOwnerId) await ticketChannel.members.add(ticketOwnerId).catch(e => console.warn(`[Reopen] Could not add owner ${ticketOwnerId}: ${e.message}`));
                if (otherTraderId) await ticketChannel.members.add(otherTraderId).catch(e => console.warn(`[Reopen] Could not add trader ${otherTraderId}: ${e.message}`));

                const originalCloseButton = new ButtonBuilder().setCustomId(`close_ticket_${ticketChannel.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('❌');
                const row = new ActionRowBuilder().addComponents(originalCloseButton);

                const reopenEmbed = new EmbedBuilder().setColor('#000000').setTitle('Ticket Reopened').setDescription(`This ticket has been reopened by ${interaction.user}. The original traders have been re-added.`);
                await ticketChannel.send({ embeds: [reopenEmbed], components: [row] });
                
                await interaction.message.delete().catch(console.error);
                return;
            }

            if (interaction.customId.startsWith('final_delete_ticket_')) {
                if (!interaction.guild) return;
                if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
                    return safeReply(interaction, { content: 'You must be an Administrator to use the final delete button.', ephemeral: true });
                }
                const ticketChannel = interaction.channel;
                if (!ticketChannel.isThread()) { return safeReply(interaction, { content: 'This action is only for ticket threads.', ephemeral: true}); }

                const replyResult = await safeReply(interaction, { content: `Ticket **${ticketChannel.name}** is being permanently deleted without logging points...`, ephemeral: true });
                if (!replyResult) return;
                
                sendServerModLog(client, 'Ticket Thread Deleted', `Ticket thread **${ticketChannel.name}** (\`${ticketChannel.id}\`) was deleted via button.`, '#FF6347', interaction.user, null, null, `Deleted by ${interaction.user.tag}.`);
                setTimeout(async () => {
                    await ticketChannel.delete(`Ticket deleted by ${interaction.user.tag}`).catch(err => {
                        console.error("Error deleting thread via button:", err);
                    });
                }, 2000);
                return;
            }

        } else if (interaction.isStringSelectMenu()) {
            console.log(`[InteractionCreate] Select menu used: ${interaction.customId} by ${interaction.user.tag}, Value: ${interaction.values[0]}`); 
            if (interaction.customId === 'mm_tier_select') { 
                const selectedTierValue = interaction.values[0]; 
                const selectedTierKey = Object.keys(mmTiers).find(key => mmTiers[key].value === selectedTierValue); 
                if (!selectedTierKey) { 
                    return safeUpdate(interaction, { content: 'Invalid middleman selected. Please try selecting again.', components: [] }); 
                }
                
                
                const ticketCheck = await hasOpenTicket(interaction.user.id, interaction.guild, 1000);
                if (ticketCheck.hasTicket) {
                    return safeUpdate(interaction, { 
                        content: `Ã¢ÂÂ You already have an open ticket: ${ticketCheck.ticketChannel}. Please close your current ticket before creating a new one.`, 
                        components: [] 
                    });
                }
                
                const showModalButton = new ButtonBuilder().setCustomId(`show_mm_modal_${selectedTierValue}`).setLabel('Provide Trade Details').setStyle(ButtonStyle.Primary); 
                const row = new ActionRowBuilder().addComponents(showModalButton); 
                await safeUpdate(interaction, { content: `${interaction.user} You selected: **${mmTiers[selectedTierKey].name}**.`, components: [row] }); 
            }
        } else if (interaction.isModalSubmit()) {
             console.log(`[InteractionCreate] Modal submitted: ${interaction.customId} by ${interaction.user.tag}`);
            if (interaction.customId.startsWith('mm_request_modal_')) {
                try {
                    await interaction.deferReply({ ephemeral: true });
                } catch (error) {
                    if (error.code === 10062) {
                        console.warn(`[ModalSubmit] Interaction expired for ${interaction.user.tag}`);
                        return;
                    }
                    throw error;
                }
                
                let thread;
                try {
                    
                    const ticketCheck = await hasOpenTicket(interaction.user.id, interaction.guild, 1500);
                    if (ticketCheck.hasTicket) {
                        return interaction.editReply({ 
                            content: `Ã¢ÂÂ You already have an open ticket: ${ticketCheck.ticketChannel}. Please close your current ticket before creating a new one.`
                        });
                    }
                    
                    const tierValue = interaction.customId.replace('mm_request_modal_', ''); 
                    const tierKey = Object.keys(mmTiers).find(key => mmTiers[key].value === tierValue); 
                    if (!tierKey) { return interaction.editReply({ content: 'Error processing request: Invalid middleman selection. Please try again.', ephemeral: true }); } 
                    
                    const traderInput = interaction.fields.getTextInputValue('trader_id_input'); 
                    const yourTradeDetails = interaction.fields.getTextInputValue('your_trade_input'); 
                    const otherTraderTradeDetails = interaction.fields.getTextInputValue('other_trader_trade_input'); 
                    const ticketCreator = interaction.user; 
                    
                    
                    console.log(`[InteractionCreate] Attempting to find user: "${traderInput}"`);
                    const otherTraderUser = await findUserByInput(traderInput, interaction.guild);
                    
                    if (!otherTraderUser) { 
                        return interaction.editReply({ 
                            content: `Ã¢ÂÂ Could not find the trader: "${traderInput}"\n\n**Try these formats:**\nÃ¢ÂÂ¢ User ID: \`123456789012345678\`\nÃ¢ÂÂ¢ Mention: \`@username\`\nÃ¢ÂÂ¢ Username: \`john_doe\` or \`JohnDoe#1234\`\nÃ¢ÂÂ¢ Display name: \`John Doe\`\n\nMake sure the user is in this server and spelled correctly.`, 
                            ephemeral: true 
                        }); 
                    }
                    
                    console.log(`[InteractionCreate] Found user: ${otherTraderUser.tag} (${otherTraderUser.id})`);
                    
                    if (otherTraderUser.bot) { return interaction.editReply({ content: 'Ã¢ÂÂ You cannot create a ticket with a bot.', ephemeral: true }); } 
                    if (otherTraderUser.id === ticketCreator.id) { return interaction.editReply({ content: 'Ã¢ÂÂ You cannot create a ticket with yourself.', ephemeral: true }); } 
                    
                    
                    const otherTraderTicketCheck = await hasOpenTicket(otherTraderUser.id, interaction.guild, 1000);
                    if (otherTraderTicketCheck.hasTicket) {
                        return interaction.editReply({ 
                            content: `Ã¢ÂÂ The other trader (${otherTraderUser.tag}) already has an open ticket: ${otherTraderTicketCheck.ticketChannel}. They need to close their current ticket first.`, 
                            ephemeral: true 
                        });
                    }
                    
                    const otherTraderMMBan = currentDB.mmBans.find(ban => ban.userId === otherTraderUser.id); 
                    if (otherTraderMMBan) { return interaction.editReply({ content: `Ã¢ÂÂ The other trader (${otherTraderUser.tag}) is currently banned from using the middleman service. Reason: ${otherTraderMMBan.reason}`, ephemeral: true }); } 
                    
                    let tierNameForThread = "MM"; const selectedTierInfo = mmTiers[tierKey]; if (selectedTierInfo && selectedTierInfo.name) { tierNameForThread = selectedTierInfo.name.split(' ')[0]; } let creatorNameForThread = ticketCreator.username.replace(/[^a-zA-Z0-9_-]/g, ''); if (creatorNameForThread.length === 0) creatorNameForThread = 'USER'; const suffix = " Ticket"; const maxBaseLength = 100 - suffix.length - tierNameForThread.length - 3; creatorNameForThread = creatorNameForThread.substring(0, maxBaseLength > 0 ? maxBaseLength : 5); const threadName = `${tierNameForThread.toUpperCase()} - ${creatorNameForThread.toUpperCase()}${suffix}`; 
                    
                    const ticketParentChannel = interaction.channel; 
                    if (!ticketParentChannel || ticketParentChannel.type !== ChannelType.GuildText) { console.error(`[InteractionCreate] Failed to get valid parent channel for thread creation.`); return interaction.editReply({ content: 'Error: Could not determine the correct channel to create the ticket in.', ephemeral: true }); } 
                    
                    thread = await ticketParentChannel.threads.create({ name: threadName, autoArchiveDuration: ThreadAutoArchiveDuration.OneDay, type: ChannelType.PrivateThread, reason: `Middleman ticket by ${ticketCreator.tag} for ${selectedTierInfo ? selectedTierInfo.name : 'Unknown Tier'}` }); 
                    
                    try { await thread.members.add(ticketCreator.id); } catch (addCreatorError) { console.error(`[InteractionCreate] Failed to add ticket creator ${ticketCreator.tag} to thread ${thread.name}:`, addCreatorError.message); await thread.delete(`Failed to add ticket creator.`).catch(delErr => console.error(`[InteractionCreate] Failed to delete thread ${thread.name} after creator add failure:`, delErr.message)); return interaction.editReply({ content: `Could not add you to the ticket. Ticket not created.`, ephemeral: true }); } 
                    try { await thread.members.add(otherTraderUser.id); } catch (addTraderError) { console.error(`[InteractionCreate] Failed to add other trader ${otherTraderUser.tag} to thread ${thread.name}:`, addTraderError.message); await thread.delete(`Failed to add other trader.`).catch(delErr => console.error(`[InteractionCreate] Failed to delete thread ${thread.name} after other trader add failure:`, delErr.message)); return interaction.editReply({ content: `Could not add the other trader (${otherTraderUser.tag}) to the ticket. Ticket not created.`, ephemeral: true }); } 
                    
                    const { mentions: roleMentionsString, keys: roleKeys } = getRoleMentionsAndKeys(interaction, tierKey); 
                    const ticketEmbed = new EmbedBuilder().setColor('#000000').setTitle(`Middleman Request`).setDescription(`**Trader 1:** ${ticketCreator}\n**Trader 2:** ${otherTraderUser}`).addFields({ name: 'Trader 1 Offer', value: `\`\`\`\n${yourTradeDetails}\n\`\`\`` }, { name: "Trader 2 Offer", value: `\`\`\`\n${otherTraderTradeDetails}\n\`\`\`` }).setTimestamp().setFooter({ text: `Ticket created by ${ticketCreator.username}`, iconURL: ticketCreator.displayAvatarURL() }); 
                    const closeButton = new ButtonBuilder().setCustomId(`close_ticket_${thread.id}`).setLabel('Close Ticket').setStyle(ButtonStyle.Danger).setEmoji('❌'); const row = new ActionRowBuilder().addComponents(closeButton); 
                    const claimButton = new ButtonBuilder()
    .setCustomId(`claim_ticket_${thread.id}`)
    .setLabel('Claim')
    .setStyle(ButtonStyle.Success)
    .setEmoji('🔐');

const rowWithClaim = new ActionRowBuilder().addComponents(closeButton, claimButton);
                    
                    let initialThreadContent = `${ticketCreator} has created a ticket with ${otherTraderUser}.`; if (roleMentionsString) { initialThreadContent += `\n\n${roleMentionsString}`; } 
                    await thread.send({ content: initialThreadContent, embeds: [ticketEmbed], components: [rowWithClaim] });
                    
                    client.db.activeTickets = client.db.activeTickets || {}; client.db.activeTickets[thread.id] = { createdAt: Date.now(), tierKey: tierKey, initialPingRoleKeys: roleKeys, lastMMResponseAt: Date.now(), reminderSent: false, guildId: interaction.guild.id, ticketCreatorId: ticketCreator.id, otherTraderId: otherTraderUser.id }; console.log(`[ActiveTickets] Ticket ${thread.id} (Name: ${thread.name}) added for MM response tracking.`);
                    
                    await interaction.editReply({ content: `Ã¢ÂÂ Ticket created! You can find it here: ${thread}\n\n**Found trader:** ${otherTraderUser.tag}`, components: [] });
                    saveDB(client.db); 

                } catch (error) { 
                    console.error('[InteractionCreate] Error during ticket thread creation or initial setup:', error); 
                    if (thread && !thread.deleted) { 
                        await thread.delete('Error during ticket setup.').catch(delErr => console.error(`[InteractionCreate] Failed to delete thread ${thread?.name} after setup error:`, delErr.message));
                    }
                    if (error.code === 50035 && error.message.includes("Invalid Form Body") && error.message.includes("name")) { 
                        await interaction.editReply({ content: 'Error creating ticket: The generated thread name is too long or contains invalid characters.', ephemeral: true }); 
                    } else if (error.code === 10003) { 
                        await interaction.editReply({ content: 'Error: Could not create the ticket thread. The parent channel may no longer exist or is inaccessible.', ephemeral: true }); 
                    } else if (error.code === 50001) { 
                        await interaction.editReply({ content: 'Error: I seem to be missing permissions to create a thread or add members in the target channel.', ephemeral: true }); 
                    } else { 
                        await interaction.editReply({ content: 'An error occurred while creating the ticket. Please check the console for more details.', ephemeral: true }); 
                    } 
                } 
            }
            else if (interaction.customId.startsWith('submit_feedback_')) {
                console.log(`[FeedbackModal] Submitted by ${interaction.user.tag}. Custom ID: ${interaction.customId}`);
                try {
                    const parts = interaction.customId.split('_'); 
                    const ticketIdSubmitted = parts[2]; 
                    const mmUserIdSubmitted = parts[3]; 
                    const rating = interaction.fields.getTextInputValue('feedback_rating'); 
                    const comments = interaction.fields.getTextInputValue('feedback_comments'); 
                    const improvement = interaction.fields.getTextInputValue('feedback_improvement');
                    
                    client.db.ticketFeedback = client.db.ticketFeedback || {}; 
                    client.db.ticketFeedback[ticketIdSubmitted] = client.db.ticketFeedback[ticketIdSubmitted] || [];
                    client.db.ticketFeedback[ticketIdSubmitted].push({ submitterId: interaction.user.id, submitterTag: interaction.user.tag, middlemanId: mmUserIdSubmitted === 'none' ? null : mmUserIdSubmitted, rating: rating, comments: comments || 'N/A', improvementSuggestions: improvement || 'N/A', timestamp: Date.now() }); 
                    saveDB(client.db);
                    
                    console.log(`[FeedbackModal] Received feedback for ticket ${ticketIdSubmitted} from ${interaction.user.tag}`);
                    
                    const thankYouEmbed = new EmbedBuilder().setColor('#000000').setTitle('Ã°ÂÂÂ Feedback Submitted!').setDescription('Thank you for your valuable feedback. It helps us improve our middleman service!').setTimestamp(); 
                    await safeReply(interaction, { embeds: [thankYouEmbed], ephemeral: true });
                    
                    const feedbackNotificationChannelId = serverModLogChannelId; 
                    if (feedbackNotificationChannelId) {
                        const feedbackNotifChannel = await client.channels.fetch(feedbackNotificationChannelId).catch(() => null);
                        if (feedbackNotifChannel && feedbackNotifChannel.isTextBased()) {
                            const mmUser = mmUserIdSubmitted !== 'none' ? await client.users.fetch(mmUserIdSubmitted).catch(() => null) : null; 
                            const mmTag = mmUser ? mmUser.tag : (mmUserIdSubmitted !== 'none' ? `ID: ${mmUserIdSubmitted}` : 'N/A'); 
                            const feedbackNotifEmbed = new EmbedBuilder().setColor('#000000').setTitle('Ã°ÂÂÂ¬ New Ticket Feedback Received').addFields({ name: 'Ticket ID', value: `\`${ticketIdSubmitted}\``, inline: true },{ name: 'Submitted By', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },{ name: 'Middleman Rated', value: mmTag, inline: true },{ name: 'Rating', value: rating },{ name: 'Comments', value: comments || 'N/A' },{ name: 'Improvement Suggestions', value: improvement || 'N/A' }).setTimestamp();
                            await feedbackNotifChannel.send({ embeds: [feedbackNotifEmbed] }).catch(e => console.error("Failed to send feedback notification:", e));
                        }
                    }
                } catch (error) {
                    console.error(`[FeedbackModal] Error processing feedback submission:`, error);
                    await safeReply(interaction, { content: 'Sorry, there was an error submitting your feedback.', ephemeral: true });
                }
            }
        }
    },
};
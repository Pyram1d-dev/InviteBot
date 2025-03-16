import { Client, SlashCommandBuilder, ButtonComponent, Interaction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, APIButtonComponent, TextChannel, Message, MessageMentionOptions } from "discord.js"
import { CronJob } from "cron"
import { resolve } from "path"
import environmentVars from "./data/vars.json"
import config from "./data/config.json"
import fs from "fs"
import { DateObjectUnits, DateTime } from "luxon"

interface DialogData {
    guildId: string,
    channelId: string,
    poster: string,
    title: string,
    attending: Array<string>,
    cannot: Array<string>,
    maybe: Array<string>,
    cooldowns: Map<string, number>,
    locked: boolean,
    endDate?: DateObjectUnits,
    cron?: CronJob
}

const partyJsonPath = "./data/dialogs.json"
const fsPath = resolve(__dirname, partyJsonPath)

const partyData: Map<string, DialogData> = new Map<string, DialogData>()
if (!fs.existsSync(fsPath))
    fs.writeFileSync(fsPath, "{}", 'utf-8')

const messageCache = new Map<string, Message>()

const temp = require(partyJsonPath)
Object.keys(temp).forEach(key => {
    partyData.set(key, temp[key])
})

const inviteCmd = new SlashCommandBuilder()
    .setName("makeinvite")
    .setDescription("Create an invitation message with buttons that tracks people who can attend your event.")
    .addStringOption(option => option.setName('title').setDescription('The title of the event').setRequired(true))
    .addStringOption(option => option.setName('enddate').setDescription('What date voting is no longer possible (mm/dd/yyyy)').setRequired(false))
    .addStringOption(option => option.setName('endtime').setDescription('What time voting is no longer possible in 24h time (hh:mm:ss)').setRequired(false))
    .addStringOption(option => option.setName('timezone').setDescription('What timezone to base end dates off of').setRequired(false).setAutocomplete(true))
    .addBooleanOption(option => option.setName('locked').setDescription('Whether or not only you can check the responses').setRequired(false))
    .addRoleOption(option => option.setName('role').setDescription('The role to ping when the invite is created').setRequired(false))

let checkCmd: any

async function setCheckCmd() {
    checkCmd = new SlashCommandBuilder()
        .setName("checkattending")
        .setDescription("Check who is attending a specific invite.")
        .addStringOption(option => {
            option.setName('messageid').setDescription('The ID of the invite message').setRequired(true).setAutocomplete(true)
            // if (partyData.size > 0) {
            //     const bruh = new Array<{ name: string, value: string }>()
            //     partyData.forEach((value, key) => bruh.push({name: value.title, value: key}))
            //     option.addChoices(...bruh)
            // }
            return option
        })
    await client.application?.commands.set([inviteCmd, checkCmd]).then(() => console.log("Commands reloaded."))
}

function flushData() {
    const toFlush: {[id: string]: DialogData} = {}
    partyData.forEach((data, key) => {
        toFlush[key] = data
    })
    const smh = new Map<string, CronJob>()
    // Javascript is dogshit
    for (const key in toFlush) {
        var corData = partyData.get(key) as DialogData
        toFlush[key].cooldowns = Object.fromEntries(corData.cooldowns) as never
        smh.set(key, toFlush[key].cron as CronJob)
        toFlush[key].cron = undefined
    }
    fs.writeFileSync(fsPath, JSON.stringify(toFlush, null, 2), 'utf-8');
    for (const key in toFlush) {
        var corData = partyData.get(key) as DialogData
        corData.cooldowns = new Map(Object.entries(corData.cooldowns))
        corData.cron = smh.get(key)
    }
    console.log(`Flushing`, partyData)
    //setCheckCmd();
}

function addUserToList(id: string, userId: string, attending: string) {
    const partyDialog = partyData.get(id) as DialogData
    partyDialog.cooldowns.set(userId, Date.now() / 1000)
    // I know how bad this looks. It's 2:30 AM, shut up.
    switch (attending) {
        case "attending":
            if (partyDialog.maybe.includes(userId))
                partyDialog.maybe.splice(partyDialog.maybe.indexOf(userId), 1)
            if (partyDialog.cannot.includes(userId))
                partyDialog.cannot.splice(partyDialog.cannot.indexOf(userId), 1)
            if (!partyDialog.attending.includes(userId))
                partyDialog.attending.push(userId)
            break;
        case "cannot":
            if (partyDialog.maybe.includes(userId))
                partyDialog.maybe.splice(partyDialog.maybe.indexOf(userId), 1)
            if (partyDialog.attending.includes(userId))
                partyDialog.attending.splice(partyDialog.attending.indexOf(userId), 1)
            if (!partyDialog.cannot.includes(userId))
                partyDialog.cannot.push(userId)
            break;
        case "maybe":
            if (partyDialog.attending.includes(userId))
                partyDialog.attending.splice(partyDialog.attending.indexOf(userId), 1)
            if (partyDialog.cannot.includes(userId))
                partyDialog.cannot.splice(partyDialog.cannot.indexOf(userId), 1)
            if (!partyDialog.maybe.includes(userId))
                partyDialog.maybe.push(userId)
            break;
    }
    //partyData.set(id, partyDialog);
    flushData();
}

console.log("Bot is starting...")
            
const row = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setCustomId('attending')
            .setLabel('Attending')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('cannot')
            .setLabel("Can't Attend")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('maybe')
            .setLabel("Might Attend")
            .setStyle(ButtonStyle.Secondary)
    )

async function fetchMessage(guildId: string, channelId: string, messageId: string): Promise<Message | undefined> {
    const g = await client.guilds.fetch(guildId);
    const ch = await g?.channels.fetch(channelId);
    if (ch) {
        try {
            return await (ch as TextChannel).messages.fetch(messageId);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

const client = new Client({
    intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions', 'GuildEmojisAndStickers', 'GuildMembers', 'MessageContent']
})
function createCronJob(msgId: string, guildId: string, channelId: string, endDate: DateObjectUnits) {
    const endTime = DateTime.fromObject(endDate, {zone: 'utc'}).setZone('local').toJSDate()
    try {
        const job = new CronJob(endTime, async () => {
            try {
                const msg = messageCache.get(msgId) ?? await fetchMessage(guildId, channelId, msgId);
                if (msg) {
                    const data = partyData.get(msgId) as DialogData
                    const embed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(data.title)
                        .setDescription(`The invite has ended. I look forward to seeing everyone who responded!`)
                        .setFooter({ text: `Attending: ${data.attending.length}\nCan't attend: ${data.cannot.length}\nDeciding: ${data.maybe.length}` })
        
                    msg.edit({ embeds: [embed], components: [] });
                }
            } catch {/* don't do shit */}
        })
        job.start();
        return job;
    } catch {
        return undefined;
    }
}
client.login(environmentVars.token).then(async () => {
    const missingMessages: string[] = [];
    for (const [key, data] of partyData) {
        const msg = await fetchMessage(data.guildId, data.channelId, key)
        if (!msg) {
            missingMessages.push(key);
            continue;
        }
        messageCache.set(key, msg);
        data.cooldowns = new Map(Object.entries(data.cooldowns))
        if (data.endDate != undefined) {
            const endTime = DateTime.fromObject(data.endDate, {zone: 'utc'}).toJSDate();
            if (Date.now() < endTime.getTime())
                data.cron = createCronJob(key, data.guildId, data.channelId, data.endDate)
        }
    }
    console.log(`Messages found: ${messageCache.size}\nMessages missing: ${missingMessages.length}`);
    if (missingMessages.length > 0) {
        missingMessages.forEach((msgId) => {
            console.log(`Removing ${partyData.get(msgId)?.title}`);
            if (partyData.has(msgId)) {
                partyData.get(msgId)?.cron?.stop()
                partyData.delete(msgId)
            }
        })
        flushData();
    }
    setCheckCmd()
    console.log(client.application?.commands.cache)
    client.on('messageDelete', async (message) => {
        console.log("PLEASE TELL ME IT DETECTED IT")
        partyData.forEach((val, id) => {
            console.log("Checking", id)
            if (message.id == id) {
                console.log(`Removing ${partyData.get(id)?.title}`);
                if (partyData.has(id)) {
                    partyData.get(id)?.cron?.stop()
                    partyData.delete(id)
                }
                flushData();
            }
        })
    })
    const timezoneAliases = new Map<string, string>([
        ['CST', 'America/Chicago'],
        ['EST', 'America/New_York'],
        ['PST', 'America/Los_Angeles'],
        ['MST', 'America/Denver'],
        ['GMT', 'Europe/London'],
        ['UTC', 'utc']
    ])
    client.on("interactionCreate", async (interaction: Interaction) => {
        if (interaction.isAutocomplete()) {
            switch (interaction.commandName) {
                case "checkattending": {
                    const invites = new Array<{ name: string, value: string }>()
                    partyData.forEach((value, key) => {
                        if (value.guildId == interaction.guildId) {
                            const text = interaction.options.getFocused()
                            if (text != '' && !value.title.toLowerCase().includes(text.toLowerCase()))
                                return;
                            invites.push({ name: value.title, value: key })
                        }
                    })
                    interaction.respond(invites);
                    break;
                }
                case "makeinvite": {
                    const results = new Array<{ name: string, value: string }>()
                    timezoneAliases.forEach((value, key) => {
                        const text = interaction.options.getFocused()
                        if (text != '' && !key.toLowerCase().includes(text.toLowerCase()))
                            return;
                        results.push({ name: key, value: value });
                    })
                    interaction.respond(results);
                    break;
                }
            }
        } else if (interaction.isCommand() || interaction.isContextMenuCommand()) {
            switch (interaction.commandName) {
                case "makeinvite": {
                    await interaction.deferReply()
                    const title = interaction.options.get('title')?.value as string
                    const enddateoption = interaction.options.get('enddate')?.value as string | undefined
                    const endtimeoption = interaction.options.get('endtime')?.value as string | undefined
                    const timezoneoption = interaction.options.get('timezone')?.value as string | undefined
                    const rolepingoption = interaction.options.get('role')?.value as string | undefined
                    const lockedoption = interaction.options.get('locked')?.value as boolean | undefined
                    let endDate: DateObjectUnits | undefined = undefined;
                    const tz = timezoneoption != undefined ? timezoneoption : 'utc'
                    if (enddateoption != undefined || endtimeoption != undefined) {
                        const dateReg = /[0-9]{2}\/[0-9]{2}\/[0-9]{4}/
                        const timeReg = /[0-9]{2}:[0-9]{2}:[0-9]{2}/

                        if (enddateoption && !dateReg.test(enddateoption)) {
                            interaction.followUp({ content: "Date invalid, please match format.", ephemeral: true })
                            return
                        }

                        if (endtimeoption && !timeReg.test(endtimeoption)) {
                            interaction.followUp({ content: "Time invalid, please match format.", ephemeral: true })
                            return
                        }

                        
                        const curDate = DateTime.now().setZone(tz);
                        let [month, day, year] = enddateoption ? enddateoption.split('/').map(val => parseInt(val)) : [curDate.month, curDate.day, curDate.year];
                        let [hours, minutes, seconds] = endtimeoption ? endtimeoption.split(':').map(val => parseInt(val)) : [0, 0, 0];

                        const adjDate = DateTime.fromObject({
                            year: year,
                            month: month,
                            day: day,
                            hour: hours,
                            minute: minutes,
                            second: seconds,
                        }, {zone: tz}).setZone('utc')
                        console.log(`${adjDate.toString()}, ${curDate.toString()}`);
                        if (curDate.toUTC().toMillis() > adjDate.toMillis()) {
                            interaction.followUp({ content: "Date cannot be in the past. Did you forget to set your time zone?", ephemeral: true });
                            return;
                        }

                        endDate = adjDate.toObject();
                        console.log(endDate)
                    }

                    const embed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(title)
                        .setDescription(`RSVP! Please respond as soon as possible.${
                            endDate != undefined ? `\nInvite ends <t:${DateTime.fromObject(endDate as DateObjectUnits, {zone: 'utc'}).toMillis() / 1000}:R>` : ''
                        }`)
                        .setFooter({ text: `No responses...` })
        
                    console.log(`Role to ping: ${rolepingoption}`);
                    let allowedMentions = { roles: [rolepingoption] } as MessageMentionOptions;
                    let pingMsg = `<@&${rolepingoption}>`;
                    if (rolepingoption === interaction.guild?.id) {
                        allowedMentions = { parse: ["everyone"] };
                        pingMsg = "@everyone";
                    }
                    interaction.followUp({ allowedMentions: allowedMentions, content: rolepingoption !== undefined ? pingMsg : undefined, 
                        embeds: [embed], 
                        components: [row as never] }).then(message => {
                        partyData.set(message.id, {
                            guildId: message.guildId as string,
                            channelId: message.channelId,
                            poster: interaction.user.id,
                            title: title,
                            attending: [],
                            cannot: [],
                            maybe: [],
                            endDate: endDate,
                            locked: lockedoption != undefined ? lockedoption : false,
                            cooldowns: new Map<string, number>(),
                            cron: endDate != undefined ? createCronJob(message.id, message.guildId as string, message.channelId, endDate) : undefined
                        });
                        messageCache.set(message.id, message);
                        flushData();
                    })
                    break;
                }
                case "checkattending": {
                    await interaction.deferReply({ephemeral: true})
                    const id = interaction.options.get('messageid')?.value as string
                    if (!partyData.has(id)) {
                        interaction.followUp({ content: "Hell nah, that shit don't exist.", ephemeral: true })
                        break;
                    }
                    let data = partyData.get(id) as DialogData
                    if (data.locked && data.poster != interaction.user.id) {
                        interaction.followUp({ content: `Only <@${data.poster}> can view the results!`, ephemeral: true })
                        break;
                    }
                    let coolString = "Attending:\n"

                    if (data.attending.length > 0)
                        for (const userId of data.attending) {
                            await client.users.fetch(userId).then(user => {
                                coolString += `- <@${user.id}>\n`
                            }).catch(thing => {
                                console.warn(thing)
                                coolString += `- ???\n`
                            })
                        }
                    else
                        coolString += "- none :(\n"

                    coolString += "\nCannot attend:\n"

                    if (data.cannot.length > 0)
                        for (const userId of data.cannot) {
                            await client.users.fetch(userId).then(user => {
                                coolString += `- <@${user.id}>\n`
                            }).catch(thing => {
                                console.warn(thing)
                                coolString += `- ???\n`
                            })
                        }
                    else
                        coolString += "- none\n"

                    coolString += "\nDeciding:\n"

                    if (data.maybe.length > 0)
                        for (const userId of data.maybe) {
                            await client.users.fetch(userId).then(user => {
                                coolString += `- <@${user.id}>\n`
                            }).catch(thing => {
                                console.warn(thing)
                                coolString += `- ???\n`
                            })
                        }
                    else
                        coolString += "- none\n"

                    //coolString = coolString.trim() + '```'
                    interaction.followUp({ content: coolString.trim(), ephemeral: true })
                    break;
                }
            }
        } else if (interaction.isButton()) {
            const button = interaction.component as ButtonComponent
            const data = button.data as APIButtonComponent & {
                custom_id: string
            }
            const partyDialog = partyData.get(interaction.message.id) as DialogData
            if (partyDialog == undefined) {
                interaction.reply({ content: "Uhhh, something went wrong.", ephemeral: true })
                return;
            }
            const userId = interaction.user.id
            if (partyDialog.cooldowns.get(userId) != undefined)
            {
                const cd = partyDialog.cooldowns.get(userId) as number
                const elapsed = Date.now() / 1000 - cd
                if (elapsed < config.cooldownTime) {
                    interaction.reply({ content: `Please wait ${Math.round(config.cooldownTime - elapsed)} seconds before changing your status.`, ephemeral: true })
                    return
                }
            }
            addUserToList(interaction.message.id, userId, data.custom_id)
            const penis = () => {
                switch (data.custom_id) {
                    case "attending":
                        return "attending!"
                    case "cannot":
                        return "unable to attend."
                    case "maybe":
                        return "deciding. Please make sure you find out if you can (or want to) soon!"
                    default:
                        return "ooga booga caveman dfaofwjwaidfhwaf"
                }
            }
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(partyDialog.title)
                .setDescription(`RSVP! Please respond as soon as possible.${
                    partyDialog.endDate != undefined ? `\nInvite ends <t:${DateTime.fromObject(partyDialog.endDate as DateObjectUnits, {zone: 'utc'}).toMillis() / 1000}:R>` : ''
                }`)
                .setFooter({ text: `Attending: ${partyDialog.attending.length}\nCan't attend: ${partyDialog.cannot.length}\nDeciding: ${partyDialog.maybe.length}` })

            console.log(DateTime.fromObject(partyDialog.endDate as DateObjectUnits, {zone: 'utc'}));
            interaction.message.edit({ embeds: [embed], components: [row as never] });
            await interaction.reply({ content: `You are now ${penis()}`, ephemeral: true });
        }
    })
}).catch(console.warn)

//console.log(client)
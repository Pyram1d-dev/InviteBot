import { Client, SlashCommandBuilder, ButtonComponent, Interaction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, APIButtonComponent, TextChannel } from "discord.js"
import { CronJob } from "cron"
import { resolve } from "path"
import environmentVars from "./data/vars.json"
import config from "./data/config.json"
import fs from "fs"

interface DialogData {
    title: string,
    attending: Array<string>,
    cannot: Array<string>,
    maybe: Array<string>,
    endDate: number[],
    cooldowns: Map<string, number>,
    cron?: CronJob
}

const partyJsonPath = "./data/dialogs.json"
const fsPath = resolve(__dirname, partyJsonPath)

let partyData: Map<string, DialogData> = new Map<string, DialogData>()
if (!fs.existsSync(fsPath))
    fs.writeFileSync(fsPath, "{}", 'utf-8')

const temp = require(partyJsonPath)
Object.keys(temp).forEach(key => {
    partyData.set(key, temp[key])
})
console.log(partyData)

const inviteCmd = new SlashCommandBuilder()
    .setName("makeinvite")
    .setDescription("Create an invitation message with buttons that tracks people who can attend your event.")
    .addStringOption(option => option.setName('title').setDescription('The title of the event').setRequired(true))
    .addStringOption(option => option.setName('enddate').setDescription('When voting is no longer possible (mm/dd/yyyy hh:mm:ss)').setRequired(true))

let checkCmd: any

async function setCheckCmd() {
    checkCmd = new SlashCommandBuilder()
        .setName("checkattending")
        .setDescription("Check who is attending a specific invite.")
        .addStringOption(option => {
            option.setName('messageid').setDescription('The ID of the invite message').setRequired(true)
            if (partyData.size > 0) {
                const bruh = new Array<{ name: string, value: string }>()
                partyData.forEach((value, key) => bruh.push({name: value.title, value: key}))
                option.addChoices(...bruh)
            }
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
    setCheckCmd();
}

function addUserToList(id: string, userId: string, attending: string) {
    const partyDialog = partyData.get(id) as DialogData
    partyDialog.cooldowns.set(userId, Date.now() / 1000)
    // I know how bad this looks. It's fucking 2:30 AM, shut your whore mouth.
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

const client = new Client({
    intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions', 'GuildEmojisAndStickers', 'GuildMembers']
})
function createCronJob(msgId: string, endDate: number[]) {
    const endTime = new Date(...(endDate as []))
    const job = new CronJob(endTime, async () => {
        const ch = await client.channels.fetch(environmentVars.channel)
        if (ch) {
            const msg = await (ch as TextChannel).messages.fetch(msgId)
            if (msg) {
                const data = partyData.get(msgId) as DialogData
                console.log(msgId, data)
                const embed = new EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(data.title)
                    .setDescription(`The invite has ended. I look forward to seeing everyone who responded!`)
                    .setFooter({ text: `Attending: ${data.attending.length}\nCan't attend: ${data.cannot.length}\nDeciding: ${data.maybe.length}` })
    
                msg.edit({ embeds: [embed], components: [] });
            }
        }
    })
    job.start()
    return job
}
client.login(environmentVars.token).then(async () => {
    partyData.forEach((data, key) => {
        data.cooldowns = new Map(Object.entries(data.cooldowns))
        const now = Date.now()
        const endTime = new Date(...(data.endDate as []))
        if (now < endTime.getTime()) {
            data.cron = createCronJob(key, data.endDate)
        }
    })
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
    client.on("interactionCreate", async (interaction: Interaction) => {
        if (interaction.isCommand() || interaction.isContextMenuCommand()) {
            if (interaction.user.id !== config.myId) {
                interaction.reply({content: "Nah bitch only the birthday boy can use this", ephemeral: true})
                return
            }
            switch (interaction.commandName) {
                case "makeinvite": {
                    await interaction.deferReply()
                    const title = interaction.options.get('title')?.value as string
                    const enddateoption = interaction.options.get('enddate')?.value as string
                    const regMoment = /[0-9]{2}\/[0-9]{2}\/[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}/

                    if (!regMoment.test(enddateoption)) {
                        interaction.followUp({ content: "Date invalid, please match format.", ephemeral: true })
                        return
                    }

                    const [dateComponents, timeComponents] = enddateoption.split(' ')
                    const [month, day, year] = dateComponents.split('/')
                    const [hours, minutes, seconds] = timeComponents.split(':')

                    const endDate = [+year, +month - 1, +day, +hours, +minutes, +seconds]
                    console.log(endDate)
                    const embed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(title)
                        .setDescription(`RSVP! Please respond as soon as possible.\nInvite ends <t:${new Date(...(endDate as [])).getTime() / 1000}:R>`)
                        .setFooter({ text: `No responses...` })
        
                    interaction.followUp({ embeds: [embed], components: [row as never] }).then(message => {
                        partyData.set(message.id, {
                            title: title,
                            attending: [],
                            cannot: [],
                            maybe: [],
                            endDate: endDate,
                            cooldowns: new Map<string, number>(),
                            cron: createCronJob(message.id, endDate)
                        });
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
                    let coolString = "Attending:\n"

                    if (data.attending.length > 0)
                        await data.attending.forEach(async userId => {
                            const user = await client.users.fetch(userId)
                            if (user !== undefined)
                                coolString += `> ${user.username}\n`
                            else
                                coolString += `> ???\n`
                        })
                    else
                        coolString += "> none :(\n"

                    coolString += "\nCannot attend:\n"

                    if (data.cannot.length > 0)
                        data.cannot.forEach(userId => {
                            const user = client.users.cache.get(userId)
                            if (user !== undefined)
                                coolString += `> ${user.username}\n`
                            else
                                coolString += `> ???\n`
                        })
                    else
                        coolString += "> none\n"

                    coolString += "\nDeciding:\n"

                    if (data.maybe.length > 0)
                        data.maybe.forEach(userId => {
                            const user = client.users.cache.get(userId)
                            if (user !== undefined)
                                coolString += `> ${user.username}\n`
                            else
                                coolString += `> ???\n`
                        })
                    else
                        coolString += "> none\n"

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
                .setDescription(`RSVP! Please respond as soon as possible.\nInvite ends <t:${new Date(...(partyDialog.endDate as [])).getTime() / 1000}:R>`)
                .setFooter({ text: `Attending: ${partyDialog.attending.length}\nCan't attend: ${partyDialog.cannot.length}\nDeciding: ${partyDialog.maybe.length}` })

            interaction.message.edit({ embeds: [embed], components: [row as never] });
            await interaction.reply({ content: `You are now ${penis()}`, ephemeral: true });
        }
    })
}).catch(console.warn)

//console.log(client)
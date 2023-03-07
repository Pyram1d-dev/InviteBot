"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const discord_js_1 = require("discord.js");
const cron_1 = require("cron");
const path_1 = require("path");
const vars_json_1 = tslib_1.__importDefault(require("./data/vars.json"));
const config_json_1 = tslib_1.__importDefault(require("./data/config.json"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const partyJsonPath = "./data/dialogs.json";
const fsPath = (0, path_1.resolve)(__dirname, partyJsonPath);
let partyData = new Map();
if (!fs_1.default.existsSync(fsPath))
    fs_1.default.writeFileSync(fsPath, "{}", 'utf-8');
const temp = require(partyJsonPath);
Object.keys(temp).forEach(key => {
    partyData.set(key, temp[key]);
});
console.log(partyData);
const inviteCmd = new discord_js_1.SlashCommandBuilder()
    .setName("makeinvite")
    .setDescription("Create an invitation message with buttons that tracks people who can attend your event.")
    .addStringOption(option => option.setName('title').setDescription('The title of the event').setRequired(true))
    .addStringOption(option => option.setName('enddate').setDescription('When voting is no longer possible (mm/dd/yyyy hh:mm:ss)').setRequired(true));
let checkCmd;
async function setCheckCmd() {
    checkCmd = new discord_js_1.SlashCommandBuilder()
        .setName("checkattending")
        .setDescription("Check who is attending a specific invite.")
        .addStringOption(option => {
        option.setName('messageid').setDescription('The ID of the invite message').setRequired(true);
        if (partyData.size > 0) {
            const bruh = new Array();
            partyData.forEach((value, key) => bruh.push({ name: value.title, value: key }));
            option.addChoices(...bruh);
        }
        return option;
    });
    await client.application?.commands.set([inviteCmd, checkCmd]).then(() => console.log("Commands reloaded."));
}
function flushData() {
    const toFlush = {};
    partyData.forEach((data, key) => {
        toFlush[key] = data;
    });
    const smh = new Map();
    for (const key in toFlush) {
        var corData = partyData.get(key);
        toFlush[key].cooldowns = Object.fromEntries(corData.cooldowns);
        smh.set(key, toFlush[key].cron);
        toFlush[key].cron = undefined;
    }
    fs_1.default.writeFileSync(fsPath, JSON.stringify(toFlush, null, 2), 'utf-8');
    for (const key in toFlush) {
        var corData = partyData.get(key);
        corData.cooldowns = new Map(Object.entries(corData.cooldowns));
        corData.cron = smh.get(key);
    }
    console.log(`Flushing`, partyData);
    setCheckCmd();
}
function addUserToList(id, userId, attending) {
    const partyDialog = partyData.get(id);
    partyDialog.cooldowns.set(userId, Date.now() / 1000);
    switch (attending) {
        case "attending":
            if (partyDialog.maybe.includes(userId))
                partyDialog.maybe.splice(partyDialog.maybe.indexOf(userId), 1);
            if (partyDialog.cannot.includes(userId))
                partyDialog.cannot.splice(partyDialog.cannot.indexOf(userId), 1);
            if (!partyDialog.attending.includes(userId))
                partyDialog.attending.push(userId);
            break;
        case "cannot":
            if (partyDialog.maybe.includes(userId))
                partyDialog.maybe.splice(partyDialog.maybe.indexOf(userId), 1);
            if (partyDialog.attending.includes(userId))
                partyDialog.attending.splice(partyDialog.attending.indexOf(userId), 1);
            if (!partyDialog.cannot.includes(userId))
                partyDialog.cannot.push(userId);
            break;
        case "maybe":
            if (partyDialog.attending.includes(userId))
                partyDialog.attending.splice(partyDialog.attending.indexOf(userId), 1);
            if (partyDialog.cannot.includes(userId))
                partyDialog.cannot.splice(partyDialog.cannot.indexOf(userId), 1);
            if (!partyDialog.maybe.includes(userId))
                partyDialog.maybe.push(userId);
            break;
    }
    flushData();
}
console.log("Bot is starting...");
const row = new discord_js_1.ActionRowBuilder()
    .addComponents(new discord_js_1.ButtonBuilder()
    .setCustomId('attending')
    .setLabel('Attending')
    .setStyle(discord_js_1.ButtonStyle.Primary), new discord_js_1.ButtonBuilder()
    .setCustomId('cannot')
    .setLabel("Can't Attend")
    .setStyle(discord_js_1.ButtonStyle.Danger), new discord_js_1.ButtonBuilder()
    .setCustomId('maybe')
    .setLabel("Might Attend")
    .setStyle(discord_js_1.ButtonStyle.Secondary));
const client = new discord_js_1.Client({
    intents: ['Guilds', 'GuildMessages', 'GuildMessageReactions', 'GuildEmojisAndStickers', 'GuildMembers']
});
function createCronJob(msgId, endDate) {
    const endTime = new Date(...endDate);
    const job = new cron_1.CronJob(endTime, async () => {
        const ch = await client.channels.fetch(vars_json_1.default.channel);
        if (ch) {
            const msg = await ch.messages.fetch(msgId);
            if (msg) {
                const data = partyData.get(msgId);
                console.log(msgId, data);
                const embed = new discord_js_1.EmbedBuilder()
                    .setColor(0x0099FF)
                    .setTitle(data.title)
                    .setDescription(`The invite has ended. I look forward to seeing everyone who responded!`)
                    .setFooter({ text: `Attending: ${data.attending.length}\nCan't attend: ${data.cannot.length}\nDeciding: ${data.maybe.length}` });
                msg.edit({ embeds: [embed], components: [] });
            }
        }
    });
    job.start();
    return job;
}
client.login(vars_json_1.default.token).then(async () => {
    partyData.forEach((data, key) => {
        data.cooldowns = new Map(Object.entries(data.cooldowns));
        const now = Date.now();
        const endTime = new Date(...data.endDate);
        if (now < endTime.getTime()) {
            data.cron = createCronJob(key, data.endDate);
        }
    });
    setCheckCmd();
    console.log(client.application?.commands.cache);
    client.on('messageDelete', async (message) => {
        console.log("PLEASE TELL ME IT DETECTED IT");
        partyData.forEach((val, id) => {
            console.log("Checking", id);
            if (message.id == id) {
                console.log(`Removing ${partyData.get(id)?.title}`);
                if (partyData.has(id)) {
                    partyData.get(id)?.cron?.stop();
                    partyData.delete(id);
                }
                flushData();
            }
        });
    });
    client.on("interactionCreate", async (interaction) => {
        if (interaction.isCommand() || interaction.isContextMenuCommand()) {
            if (interaction.user.id !== config_json_1.default.myId) {
                interaction.reply({ content: "Nah bitch only the birthday boy can use this", ephemeral: true });
                return;
            }
            switch (interaction.commandName) {
                case "makeinvite": {
                    await interaction.deferReply();
                    const title = interaction.options.get('title')?.value;
                    const enddateoption = interaction.options.get('enddate')?.value;
                    const regMoment = /[0-9]{2}\/[0-9]{2}\/[0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2}/;
                    if (!regMoment.test(enddateoption)) {
                        interaction.followUp({ content: "Date invalid, please match format.", ephemeral: true });
                        return;
                    }
                    const [dateComponents, timeComponents] = enddateoption.split(' ');
                    const [month, day, year] = dateComponents.split('/');
                    const [hours, minutes, seconds] = timeComponents.split(':');
                    const endDate = [+year, +month - 1, +day, +hours, +minutes, +seconds];
                    console.log(endDate);
                    const embed = new discord_js_1.EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle(title)
                        .setDescription(`RSVP! Please respond as soon as possible.\nInvite ends <t:${new Date(...endDate).getTime() / 1000}:R>`)
                        .setFooter({ text: `No responses...` });
                    interaction.followUp({ embeds: [embed], components: [row] }).then(message => {
                        partyData.set(message.id, {
                            title: title,
                            attending: [],
                            cannot: [],
                            maybe: [],
                            endDate: endDate,
                            cooldowns: new Map(),
                            cron: createCronJob(message.id, endDate)
                        });
                        flushData();
                    });
                    break;
                }
                case "checkattending": {
                    await interaction.deferReply({ ephemeral: true });
                    const id = interaction.options.get('messageid')?.value;
                    if (!partyData.has(id)) {
                        interaction.followUp({ content: "Hell nah, that shit don't exist.", ephemeral: true });
                        break;
                    }
                    let data = partyData.get(id);
                    let coolString = "Attending:\n";
                    if (data.attending.length > 0)
                        await data.attending.forEach(async (userId) => {
                            const user = await client.users.fetch(userId);
                            if (user !== undefined)
                                coolString += `> ${user.username}\n`;
                            else
                                coolString += `> ???\n`;
                        });
                    else
                        coolString += "> none :(\n";
                    coolString += "\nCannot attend:\n";
                    if (data.cannot.length > 0)
                        data.cannot.forEach(userId => {
                            const user = client.users.cache.get(userId);
                            if (user !== undefined)
                                coolString += `> ${user.username}\n`;
                            else
                                coolString += `> ???\n`;
                        });
                    else
                        coolString += "> none\n";
                    coolString += "\nDeciding:\n";
                    if (data.maybe.length > 0)
                        data.maybe.forEach(userId => {
                            const user = client.users.cache.get(userId);
                            if (user !== undefined)
                                coolString += `> ${user.username}\n`;
                            else
                                coolString += `> ???\n`;
                        });
                    else
                        coolString += "> none\n";
                    interaction.followUp({ content: coolString.trim(), ephemeral: true });
                    break;
                }
            }
        }
        else if (interaction.isButton()) {
            const button = interaction.component;
            const data = button.data;
            const partyDialog = partyData.get(interaction.message.id);
            const userId = interaction.user.id;
            if (partyDialog.cooldowns.get(userId) != undefined) {
                const cd = partyDialog.cooldowns.get(userId);
                const elapsed = Date.now() / 1000 - cd;
                if (elapsed < config_json_1.default.cooldownTime) {
                    interaction.reply({ content: `Please wait ${Math.round(config_json_1.default.cooldownTime - elapsed)} seconds before changing your status.`, ephemeral: true });
                    return;
                }
            }
            addUserToList(interaction.message.id, userId, data.custom_id);
            const penis = () => {
                switch (data.custom_id) {
                    case "attending":
                        return "attending!";
                    case "cannot":
                        return "unable to attend.";
                    case "maybe":
                        return "deciding. Please make sure you find out if you can (or want to) soon!";
                    default:
                        return "ooga booga caveman dfaofwjwaidfhwaf";
                }
            };
            const embed = new discord_js_1.EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(partyDialog.title)
                .setDescription(`RSVP! Please respond as soon as possible.\nInvite ends <t:${new Date(...partyDialog.endDate).getTime() / 1000}:R>`)
                .setFooter({ text: `Attending: ${partyDialog.attending.length}\nCan't attend: ${partyDialog.cannot.length}\nDeciding: ${partyDialog.maybe.length}` });
            interaction.message.edit({ embeds: [embed], components: [row] });
            await interaction.reply({ content: `You are now ${penis()}`, ephemeral: true });
        }
    });
}).catch(console.warn);

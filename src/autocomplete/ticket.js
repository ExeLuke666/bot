const { Autocompleter } = require('@eartharoid/dbf');
const emoji = require('node-emoji');
const Cryptr = require('cryptr');
const { decrypt } = new Cryptr(process.env.ENCRYPTION_KEY);

module.exports = class TicketCompleter extends Autocompleter {
	constructor(client, options) {
		super(client, {
			...options,
			id: 'ticket',
		});
	}

	/**
	 * @param {string} value
	 * @param {*} command
	 * @param {import("discord.js").AutocompleteInteraction} interaction
	 */
	async run(value, command, interaction) {
		/** @type {import("client")} */
		const client = this.client;
		const settings = await client.prisma.guild.findUnique({ where: { id: interaction.guild.id } });
		const tickets = await client.prisma.ticket.findMany({
			include: {
				category: {
					select: {
						emoji: true,
						name: true,
					},
				},
			},
			where: {
				createdById: interaction.user.id,
				guildId: interaction.guild.id,
				open: ['add', 'close', 'force-close', 'remove'].includes(command.name), // false for `new`, `transcript` etc
			},
		});
		const options = value ? tickets.filter(t =>
			String(t.number).match(new RegExp(value, 'i')) ||
			t.topic?.match(new RegExp(value, 'i')) ||
			new Date(t.createdAt).toLocaleString(settings.locale, { dateStyle: 'short' })?.match(new RegExp(value, 'i')),
		) : tickets;
		await interaction.respond(
			options
				.slice(0, 25)
				.map(t => {
					const date = new Date(t.createdAt).toLocaleString(settings.locale, { dateStyle: 'short' });
					const topic = t.topic ? '| ' + decrypt(t.topic).substring(0, 50) : '';
					const category = emoji.hasEmoji(t.category.emoji) ? emoji.get(t.category.emoji) + ' ' + t.category.name : t.category.name;
					return {
						name: `${category} #${t.number} - ${date} ${topic}`,
						value: t.id,
					};
				}),
		);
	}
};
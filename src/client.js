const { FrameworkClient } = require('@eartharoid/dbf');
const { GatewayIntentBits, Partials } = require('discord.js');
const { PrismaClient } = require('@prisma/client');
const Keyv = require('keyv');
const I18n = require('@eartharoid/i18n');
const fs = require('fs');
const { join } = require('path');
const YAML = require('yaml');
const TicketManager = require('./lib/tickets/manager');
const sqliteMiddleware = require('./lib/middleware/prisma-sqlite');
const ms = require('ms');

module.exports = class Client extends FrameworkClient {
	constructor(config, log) {
		const intents = [
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.DirectMessageReactions,
			GatewayIntentBits.DirectMessageTyping,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildMessages,
		];

		if (process.env.PUBLIC_BOT !== 'true') {
			intents.push(GatewayIntentBits.GuildPresences);
		}

		super(
			{
				intents,
				partials: [
					Partials.Channel,
					Partials.Message,
					Partials.Reaction,
				],
				shards: 'auto',
			},
			{ baseDir: __dirname },
		);

		this.config = config;
		this.log = log;
		this.supers = (process.env.SUPER ?? '').split(',');

		this.locales = this.loadLocales();
		this.keyv = new Keyv();
		this.i18n = new I18n('en-GB', this.locales);
		this.tickets = new TicketManager(this);

		this.commands.interceptor = this.handleInteraction.bind(this);
	}

	loadLocales() {
		const locales = {};
		fs.readdirSync(join(__dirname, 'i18n'))
			.filter(file => file.endsWith('.yml'))
			.forEach(file => {
				const data = fs.readFileSync(join(__dirname, 'i18n', file), 'utf8');
				const name = file.slice(0, -4);
				locales[name] = YAML.parse(data);
			});
		return locales;
	}

	async handleInteraction(interaction) {
		if (!interaction.inGuild()) return;
		const id = interaction.guildId;
		const cacheKey = `cache/known/guild:${id}`;

		if (await this.keyv.has(cacheKey)) return;

		await this.prisma.guild.upsert({
			create: {
				id,
				locale: this.i18n.locales.find(locale => locale === interaction.guild.preferredLocale),
			},
			update: {},
			where: { id },
		});

		await this.keyv.set(cacheKey, true);
	}

	async login(token) {
		const levels = ['error', 'info', 'warn'];
		if (this.config.logs.level === 'debug') levels.push('query');

		const prismaOptions = {
			log: levels.map(level => ({ emit: 'event', level })),
		};

		if (process.env.DB_PROVIDER === 'sqlite' && !process.env.DB_CONNECTION_URL) {
			prismaOptions.datasources = { db: { url: `file:${join(process.cwd(), './user/database.db')}` } };
		}

		this.prisma = new PrismaClient(prismaOptions);

		this.prisma.$on('error', e => this.log.error.prisma(`${e.target} ${e.message}`));
		this.prisma.$on('info', e => this.log.info.prisma(`${e.target} ${e.message}`));
		this.prisma.$on('warn', e => this.log.warn.prisma(`${e.target} ${e.message}`));
		this.prisma.$on('query', e => this.log.debug.prisma(e));

		if (process.env.DB_PROVIDER === 'sqlite') {
			this.prisma.$use(sqliteMiddleware);
			this.log.debug(await this.prisma.$queryRaw`PRAGMA journal_mode=WAL;`);
			this.log.debug(await this.prisma.$queryRaw`PRAGMA synchronous=normal;`);

			setInterval(async () => {
				this.log.debug(await this.prisma.$queryRaw`PRAGMA optimize;`);
			}, ms('6h'));
		}

		return super.login(token);
	}

	async destroy() {
		await this.prisma.$disconnect();
		return super.destroy();
	}
};

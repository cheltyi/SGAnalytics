const { Client, Intents, MessageActionRow, MessageButton } = require('discord.js');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const sqlite3 = require('sqlite3').verbose();
const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MEMBERS, Intents.FLAGS.GUILD_MESSAGES] });

// Подключение к базе данных SQLite
const db = new sqlite3.Database('./analytics/members.db', (err) => {
    if (err) {
        console.error('Ошибка при подключении к базе данных:', err.message);
    } else {
        console.log('Подключено к базе данных SQLite.');
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS member_counts (
                guild_id TEXT,
                timestamp INTEGER,
                count INTEGER
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS message_counts (
                guild_id TEXT,
                date TEXT,
                count INTEGER
            )`);
        });
    }
});

// Функция для записи количества участников
function logMemberCount(guild) {
    const count = guild.memberCount;
    const timestamp = Math.floor(Date.now() / 1000);
    db.run(`INSERT INTO member_counts (guild_id, timestamp, count) VALUES (?, ?, ?)`, [guild.id, timestamp, count], (err) => {
        if (err) {
            console.error('Ошибка при записи данных участников:', err.message);
        }
    });
}

// Функция для обновления количества сообщений
function updateMessageCount(guildId) {
    const today = new Date().toISOString().split('T')[0];
    db.get(`SELECT count FROM message_counts WHERE guild_id = ? AND date = ?`, [guildId, today], (err, row) => {
        if (err) {
            console.error('Ошибка при получении данных сообщений:', err.message);
            return;
        }
        if (row) {
            db.run(`UPDATE message_counts SET count = count + 1 WHERE guild_id = ? AND date = ?`, [guildId, today], (err) => {
                if (err) {
                    console.error('Ошибка при обновлении данных сообщений:', err.message);
                }
            });
        } else {
            db.run(`INSERT INTO message_counts (guild_id, date, count) VALUES (?, ?, 1)`, [guildId, today], (err) => {
                if (err) {
                    console.error('Ошибка при вставке данных сообщений:', err.message);
                }
            });
        }
    });
}

// Логирование количества участников каждые 1 час
client.on('ready', () => {
    console.log(`Вошёл как ${client.user.tag}`);
    client.guilds.cache.forEach(guild => {
        logMemberCount(guild);
        setInterval(() => logMemberCount(guild), 60 * 60 * 1000); // 1 час
    });
});

// Отслеживание сообщений
client.on('messageCreate', message => {
    if (message.guild) {
        updateMessageCount(message.guild.id);
    }
});

// Команда /members
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'members') {
        const timeFrame = interaction.options.getString('timeframe') || 'day';
        const guildId = interaction.guild.id;

        // Получение данных участников из базы
        db.all(`SELECT timestamp, count FROM member_counts WHERE guild_id = ? ORDER BY timestamp ASC`, [guildId], (err, rows) => {
            if (err) {
                console.error('Ошибка при получении данных участников:', err.message);
                interaction.reply('Произошла ошибка при получении данных участников.');
                return;
            }

            // Фильтрация данных по выбранному интервалу
            const now = Math.floor(Date.now() / 1000);
            let filtered = rows;
            switch (timeFrame) {
                case 'day':
                    filtered = rows.filter(row => row.timestamp >= now - 24 * 60 * 60);
                    break;
                case 'week':
                    filtered = rows.filter(row => row.timestamp >= now - 7 * 24 * 60 * 60);
                    break;
                case 'month':
                    filtered = rows.filter(row => row.timestamp >= now - 30 * 24 * 60 * 60);
                    break;
                case 'year':
                    filtered = rows.filter(row => row.timestamp >= now - 365 * 24 * 60 * 60);
                    break;
                default:
                    break;
            }

            const labels = filtered.map(row => new Date(row.timestamp * 1000).toLocaleDateString());
            const data = filtered.map(row => row.count);

            // Создание графика
            const width = 800;
            const height = 400;
            const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
            const configuration = {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Количество участников',
                        data: data,
                        borderColor: 'rgba(75, 192, 192, 1)',
                        fill: false,
                    }]
                },
                options: {
                    scales: {
                        x: { display: true },
                        y: { beginAtZero: true }
                    }
                }
            };
            chartJSNodeCanvas.renderToBuffer(configuration).then(buffer => {
                interaction.reply({ files: [{ attachment: buffer, name: 'members.png' }] });
            }).catch(error => {
                console.error('Ошибка при создании графика участников:', error);
                interaction.reply('Произошла ошибка при создании графика участников.');
            });
        });
    } else if (interaction.commandName === 'messages') {
        const timeFrame = interaction.options.getString('timeframe') || 'day';
        const guildId = interaction.guild.id;

        // Получение данных сообщений из базы
        db.all(`SELECT date, count FROM message_counts WHERE guild_id = ? ORDER BY date ASC`, [guildId], (err, rows) => {
            if (err) {
                console.error('Ошибка при получении данных сообщений:', err.message);
                interaction.reply('Произошла ошибка при получении данных сообщений.');
                return;
            }

            // Фильтрация данных по выбранному интервалу
            const today = new Date();
            let filtered;
            switch (timeFrame) {
                case 'day':
                    const day = today.toISOString().split('T')[0];
                    filtered = rows.filter(row => row.date === day);
                    break;
                case 'week':
                    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    filtered = rows.filter(row => row.date >= weekAgo);
                    break;
                case 'month':
                    const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    filtered = rows.filter(row => row.date >= monthAgo);
                    break;
                case 'year':
                    const yearAgo = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                    filtered = rows.filter(row => row.date >= yearAgo);
                    break;
                default:
                    filtered = rows;
                    break;
            }

            const labels = filtered.map(row => row.date);
            const data = filtered.map(row => row.count);

            // Создание графика
            const width = 800;
            const height = 400;
            const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });
            const configuration = {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Количество сообщений',
                        data: data,
                        backgroundColor: 'rgba(153, 102, 255, 0.6)',
                    }]
                },
                options: {
                    scales: {
                        x: { display: true },
                        y: { beginAtZero: true }
                    }
                }
            };
            chartJSNodeCanvas.renderToBuffer(configuration).then(buffer => {
                interaction.reply({ files: [{ attachment: buffer, name: 'messages.png' }] });
            }).catch(error => {
                console.error('Ошибка при создании графика сообщений:', error);
                interaction.reply('Произошла ошибка при создании графика сообщений.');
            });
        });
    }
});

// Команды для взаимодействия
client.on('ready', async () => {
    const guilds = client.guilds.cache.map(guild => guild.id);
    for (const guildId of guilds) {
        const guild = await client.guilds.fetch(guildId);
        await guild.commands.create({
            name: 'members',
            description: 'Показать статистику участников',
            options: [
                {
                    name: 'timeframe',
                    type: 'STRING',
                    description: 'Выберите временной интервал',
                    required: false,
                    choices: [
                        { name: 'День', value: 'day' },
                        { name: 'Неделя', value: 'week' },
                        { name: 'Месяц', value: 'month' },
                        { name: 'Год', value: 'year' },
                    ],
                },
            ],
        });

        await guild.commands.create({
            name: 'messages',
            description: 'Показать статистику сообщений',
            options: [
                {
                    name: 'timeframe',
                    type: 'STRING',
                    description: 'Выберите временной интервал',
                    required: false,
                    choices: [
                        { name: 'День', value: 'day' },
                        { name: 'Неделя', value: 'week' },
                        { name: 'Месяц', value: 'month' },
                        { name: 'Год', value: 'year' },
                    ],
                },
            ],
        });
    }
});

client.login('YOUR_BOT_TOKEN');

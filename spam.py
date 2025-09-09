import discord
import asyncio
import re
import shlex
import os
intents = discord.Intents.default()
intents.message_content = True  # needed so your bot can read messages

print("Script started")

TOKEN = os.getenv("DISCORD_TOKEN")
OWNER_ID = 1327661459278401546

client = discord.Client(intents=intents)

spam_tasks = {}  # channel_id: asyncio.Task
spam_meta = {}   # channel_id: (item, interval_raw)

def parse_interval(text):
    match = re.fullmatch(r"(\d*\.?\d+)([smhd])", text.lower())
    if not match:
        return None
    value, unit = match.groups()
    value = float(value)
    multiplier = {"s": 1, "m": 60, "h": 3600, "d": 86400}
    return value * multiplier[unit]

@client.event
async def on_ready():
    print(f"✅ Logged in as {client.user}")

async def spam_loop(channel, item, interval):
    try:
        while True:
            await channel.send(item)
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        print(f"Error in spam loop: {e}")

@client.event
async def on_message(message):
    if message.author.id != OWNER_ID:
        return

    content = message.content.strip()
    channel_id = message.channel.id

    try:
        parts = shlex.split(content)
    except ValueError:
        await message.channel.send("❌ Invalid command format.")
        return

    if len(parts) == 0:
        return

    command = parts[0].lower()

    if command == "!macro":
        if len(parts) < 3:
            await message.channel.send("❌ Usage: `!macro [item] [interval like 2s, 1.5m, 0.5h]`")
            return

        item = parts[1]
        interval_raw = parts[2]
        interval = parse_interval(interval_raw)
        if interval is None:
            await message.channel.send("❌ Invalid interval format. Use like `2s`, `1.5m`, `0.5h`, `1d`.")
            return

        if channel_id in spam_tasks:
            spam_tasks[channel_id].cancel()

        task = asyncio.create_task(spam_loop(message.channel, item, interval))
        spam_tasks[channel_id] = task
        spam_meta[channel_id] = (item, interval_raw)

        await message.channel.send(f"**✓ Macroing `{item}` every `{interval_raw}`**")

    elif command == "!stop":
        if channel_id in spam_tasks:
            spam_tasks[channel_id].cancel()
            del spam_tasks[channel_id]
            del spam_meta[channel_id]
            await message.channel.send("**🛑 Stopped macroing.**")
        else:
            await message.channel.send("⚠️ No active macro in this channel.")

    elif command == "!stopall":
        if not spam_tasks:
            await message.channel.send("📭 No active macros to stop.")
            return

        for task in spam_tasks.values():
            task.cancel()
        spam_tasks.clear()
        spam_meta.clear()
        await message.channel.send("**🛑 Stopped all macros.**")

    elif command == "!status":
        user = message.author
        if not spam_meta:
            try:
                await user.send("📭 No active macros.")
            except:
                pass
            return

        status_lines = ["### Active Macros:"]
        for cid, (item, interval_raw) in spam_meta.items():
            channel = client.get_channel(cid)
            if channel:
                guild_name = channel.guild.name if channel.guild else "DM"
                channel_name = f"#{channel.name}" if hasattr(channel, "name") else "DM"
                status_lines.append(
                    f"- Server: {guild_name} | Channel: {channel_name}\n  → Macroing `{item}` every `{interval_raw}`"
                )

        status_message = "\n".join(status_lines)
        try:
            await user.send(status_message)
        except:
            pass

client.run(TOKEN)

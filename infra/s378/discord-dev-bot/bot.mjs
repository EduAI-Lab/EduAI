import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { loadConfig } from "./config.mjs";
import {
  getRepoStatus,
  isAuthorized,
  isSafeBranchInput,
  summarizeOutput,
} from "./lib.mjs";

const config = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.join(scriptDirectory, "deploy-branch.sh");
let deploymentInProgress = false;

function runDeployment(branch, actor) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [deployScript, branch, actor], {
      cwd: config.repo,
      env: {
        ...process.env,
        EDUAI_REPO: config.repo,
        EDUAI_HEALTH_URL: config.healthUrl,
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const error = new Error(`Deployment exited with code ${code}`);
        error.output = `${stdout}\n${stderr}`;
        reject(error);
      }
    });
  });
}

async function getNotificationChannel() {
  const channel = await client.channels.fetch(config.channelId);
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error("DISCORD_CHANNEL_ID is not a text channel the bot can send to");
  }
  return channel;
}

async function announce({ ok, branch, actor, output }) {
  const status = await getRepoStatus(config.repo).catch(() => null);
  const embed = new EmbedBuilder()
    .setColor(ok ? 0x2ecc71 : 0xe74c3c)
    .setTitle(ok ? "Dev server updated" : "Dev server update failed")
    .setDescription(
      ok
        ? `The shared dev server is now on \`${status?.branch || branch}\` at \`${status?.sha || "unknown"}\`.`
        : `Could not switch the shared dev server to \`${branch}\`.`,
    )
    .addFields(
      { name: "Requested by", value: actor, inline: true },
      {
        name: "Working tree",
        value: status?.dirty ? "Has local changes" : "Clean",
        inline: true,
      },
    )
    .setTimestamp();

  if (!ok && output) {
    embed.addFields({
      name: "Error",
      value: `\`\`\`\n${summarizeOutput(output, 900)}\n\`\`\``,
    });
  }

  const channel = await getNotificationChannel();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Discord dev bot logged in as ${readyClient.user.tag}`);
  try {
    const status = await getRepoStatus(config.repo);
    console.log(
      `Current checkout: ${status.branch}@${status.sha}${status.dirty ? " (dirty)" : ""}`,
    );
  } catch (error) {
    console.error(`Cannot read EDUAI_REPO (${config.repo}):`, error);
  }

  if (config.allowedUserIds.size === 0 && config.allowedRoleIds.size === 0) {
    console.warn(
      "No allowed Discord users or roles are configured; /dev-branch is deny-all.",
    );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.guildId !== config.guildId) {
    return;
  }

  if (interaction.commandName === "dev-status") {
    try {
      const status = await getRepoStatus(config.repo);
      await interaction.reply({
        content: `Dev server: \`${status.branch}\` at \`${status.sha}\` (${status.dirty ? "local changes present" : "clean checkout"}).`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error("Could not read the dev-server checkout:", error);
      await interaction.reply({
        content: "I could not read the dev-server checkout. Check the bot logs.",
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (interaction.commandName !== "dev-branch") return;

  const authorized = isAuthorized(
    interaction.member,
    interaction.user.id,
    config.allowedUserIds,
    config.allowedRoleIds,
  );
  if (!authorized) {
    await interaction.reply({
      content: "You are not authorized to change the shared dev server branch.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const branch = interaction.options.getString("branch", true);
  if (!isSafeBranchInput(branch)) {
    await interaction.reply({
      content: "That is not a valid branch name.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (deploymentInProgress) {
    await interaction.reply({
      content: "Another dev-server deployment is already running. Try again after it finishes.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  deploymentInProgress = true;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const actor = `${interaction.user.tag} (${interaction.user.id})`;

  try {
    await runDeployment(branch, actor);
  } catch (error) {
    const output = error.output || error.stack || error.message;
    console.error(output);
    await interaction.editReply(
      `The deployment failed. No success was reported. Check the bot service logs for details.`,
    ).catch((replyError) => {
      console.error("Could not send the failed-deployment interaction reply:", replyError);
    });
    await announce({ ok: false, branch, actor, output }).catch(console.error);
    deploymentInProgress = false;
    return;
  }

  const status = await getRepoStatus(config.repo).catch(() => ({
    branch,
    sha: "unknown",
  }));
  await interaction.editReply(
    `Dev server updated to \`${status.branch}\` at \`${status.sha}\`.`,
  ).catch((error) => {
    console.error("Deployment succeeded, but the interaction reply failed:", error);
  });
  await announce({ ok: true, branch, actor }).catch((error) => {
    console.error("Deployment succeeded, but the channel announcement failed:", error);
  });
  deploymentInProgress = false;
});

process.on("SIGTERM", () => {
  client.destroy();
  process.exit(0);
});

await client.login(config.token);

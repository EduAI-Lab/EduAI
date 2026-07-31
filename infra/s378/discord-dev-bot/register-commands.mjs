import {
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { loadConfig } from "./config.mjs";

const config = loadConfig();
const commands = [
  new SlashCommandBuilder()
    .setName("dev-status")
    .setDescription("Show the branch and commit running on the shared dev server"),
  new SlashCommandBuilder()
    .setName("dev-branch")
    .setDescription("Deploy a remote branch to the shared dev server")
    .addStringOption((option) =>
      option
        .setName("branch")
        .setDescription("Exact branch name on origin")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(200),
    ),
].map((command) => command.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);
await rest.put(
  Routes.applicationGuildCommands(config.applicationId, config.guildId),
  { body: commands },
);

console.log(`Registered ${commands.length} guild commands.`);

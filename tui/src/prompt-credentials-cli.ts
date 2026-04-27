import prompts from "prompts";
import { getConfig } from "./config.ts";
import { credentialsFilePath, saveUserCredentials } from "./user-credentials.ts";

/**
 * Collect API keys without echoing them (readline.question leaves pasted secrets in scrollback).
 */
export async function promptCredentialsIfNeeded(): Promise<void> {
  if (getConfig().isConfigured) return;

  console.log("");
  console.log(`Research Partner needs API keys. They will be saved to ${credentialsFilePath()}`);
  console.log("(Environment variables FIREWORKS_API_KEY / ALDER_API_KEY override that file.)");
  console.log("Keys are not shown while you type or paste.\n");

  while (!getConfig().isConfigured) {
    const response = await prompts(
      [
        {
          type: "invisible",
          name: "fireworks",
          message: "Fireworks API key",
        },
        {
          type: "invisible",
          name: "alder",
          message: "Alder API key",
        },
      ],
      {
        onCancel: () => {
          process.exit(0);
        },
      },
    );

    const fireworks = String(response?.fireworks ?? "").trim();
    const alder = String(response?.alder ?? "").trim();

    if (!fireworks || !alder) {
      console.log("\nBoth keys are required. Try again, or press Ctrl+C to exit.\n");
      continue;
    }

    saveUserCredentials({ fireworksApiKey: fireworks, alderApiKey: alder });
  }
}

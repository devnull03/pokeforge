/**
 * Deploy module: deploys a generated Python MCP server to Modal.
 * Uses MODAL_TOKEN_ID and MODAL_TOKEN_SECRET for auth (no interactive login).
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

export interface DeployOutput {
  url: string;
  mcpEndpoint: string;
  output: string;
}

/**
 * Deploy a generated server directory to Modal.
 * The directory must contain a deploy_modal.py file.
 */
export async function deployToModal(serverDir: string): Promise<DeployOutput> {
  const deployScript = path.join(serverDir, "deploy_modal.py");
  if (!existsSync(deployScript)) {
    throw new Error(`No deploy_modal.py found in ${serverDir}`);
  }

  if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
    throw new Error(
      "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET must be set in .env. " +
      "Get them from https://modal.com/settings -> API Tokens."
    );
  }

  const output = execSync("modal deploy deploy_modal.py", {
    cwd: serverDir,
    encoding: "utf-8",
    timeout: 180_000,
    env: {
      ...process.env,
      MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
      MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
    },
  });

  // Parse URL from Modal output (e.g. "https://jniranja--mcp-xxx-web.modal.run")
  const urlMatch = output.match(/https:\/\/\S+\.modal\.run/);
  if (!urlMatch) {
    throw new Error(`Could not find Modal URL in output:\n${output}`);
  }

  const url = urlMatch[0];
  return {
    url,
    mcpEndpoint: `${url}/mcp/`,
    output,
  };
}

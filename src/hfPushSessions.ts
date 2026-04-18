// SPDX-License-Identifier: Apache-2.0
/**
 * Placeholder implementation for the `hf-push-sessions` command.
 *
 * Intended purpose (based on the name) is to push saved RPC client session
 * data to the Hugging Face Hub. The actual logic will depend on the project
 * requirements and the HF API client you use. For now we provide a minimal
 * skeleton that can be expanded later.
 */

import fs from 'fs';
import logger from './logger';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Simple helper to print usage information.
 */
function printUsage() {
  logger.info(`Usage: hf-push-sessions [options]

Options:
  --session-dir <dir>   Directory containing session files to push (default: ./sessions)
  --repo <repo>         Hugging Face repository name (e.g., username/repo)
  --token <token>       HF access token (or set HF_TOKEN env variable)
`);
}

/**
 * Main entry point.
 */
async function main() {
  const args = process.argv.slice(2);
  const opts: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-dir' && i + 1 < args.length) {
      opts.sessionDir = args[++i];
    } else if (args[i] === '--repo' && i + 1 < args.length) {
      opts.repo = args[++i];
    } else if (args[i] === '--token' && i + 1 < args.length) {
      opts.token = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    } else {
      logger.error(`Unknown option: ${args[i]}`);
      printUsage();
      process.exit(1);
    }
  }

  const sessionDir = opts.sessionDir ?? path.resolve('sessions');
  const repo = opts.repo;
  const token = opts.token ?? process.env.HF_TOKEN;

  if (!repo) {
    logger.error('Error: --repo is required');
    printUsage();
    process.exit(1);
  }
  if (!token) {
    logger.error('Error: Hugging Face token not provided (use --token or HF_TOKEN env)');
    process.exit(1);
  }

  // Ensure the session directory exists
  if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
    logger.error(`Session directory does not exist: ${sessionDir}`);
    process.exit(1);
  }

  // Collect all files in the session directory
  const files = fs.readdirSync(sessionDir).filter(f => fs.statSync(path.join(sessionDir, f)).isFile());
  if (files.length === 0) {
    logger.info('No session files found to push.');
    return;
  }

  logger.info(`Pushing ${files.length} session file(s) to ${repo}...`);

  // Simple approach: use the `huggingface-cli` if available.
  // This avoids adding a heavy dependency just for a placeholder.
  try {
    // Log in using the token (writes to local config)
    execSync(`huggingface-cli login --token ${token}`, { stdio: 'inherit' });
    // Create repo if it doesn't exist
    execSync(`huggingface-cli repo create ${repo} --type model --private`, { stdio: 'inherit' });
    // Clone the repo to a temp folder
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hf-repo-'));
    execSync(`git clone https://huggingface.co/${repo} ${tmpDir}`, { stdio: 'inherit' });
    // Copy session files into the repo
    for (const file of files) {
      const src = path.join(sessionDir, file);
      const dest = path.join(tmpDir, file);
      fs.copyFileSync(src, dest);
    }
    // Commit and push
    execSync('git add .', { cwd: tmpDir, stdio: 'inherit' });
    execSync('git commit -m "Add session files"', { cwd: tmpDir, stdio: 'inherit' });
    execSync('git push', { cwd: tmpDir, stdio: 'inherit' });
    logger.info('Push completed successfully.');
  } catch (e) {
    logger.error('Failed to push sessions:', e);
    process.exit(1);
  }
}

// Execute when run directly
if (require.main === module) {
  main();
}

export default main;

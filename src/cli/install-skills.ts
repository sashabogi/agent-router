/**
 * Install AgentRouter skills to ~/.claude/skills/agent-router/
 *
 * Copies skill files from the package's skills/ directory to the user's
 * Claude Code skills directory for easy access via slash commands.
 */

import * as p from "@clack/prompts";
import color from "picocolors";
import { mkdir, readdir, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// ============================================================================
// Constants
// ============================================================================

/** Destination directory for skills */
const SKILLS_DEST_DIR = join(homedir(), ".claude", "skills", "agent-router");

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the package root directory (where skills/ folder lives)
 */
function getPackageRoot(): string {
  // In ESM, use import.meta.url to find our location
  const currentFile = fileURLToPath(import.meta.url);
  // We're in dist/cli/install-skills.js or src/cli/install-skills.ts
  // Package root is two levels up
  return dirname(dirname(dirname(currentFile)));
}

/**
 * Get list of skill files from the package's skills/ directory
 */
async function getSkillFiles(skillsDir: string): Promise<string[]> {
  try {
    const files = await readdir(skillsDir);
    return files.filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

/**
 * Extract skill command name from filename
 * e.g., "multi-provider-build.md" -> "/multi-provider-build"
 */
function getSkillCommand(filename: string): string {
  return "/" + basename(filename, ".md");
}

// ============================================================================
// Main Install Function
// ============================================================================

/**
 * Install AgentRouter skills to the user's Claude Code skills directory
 */
export async function installSkills(): Promise<void> {
  p.intro(color.bgCyan(color.black(" AgentRouter Skill Installer ")));

  const packageRoot = getPackageRoot();
  const skillsSourceDir = join(packageRoot, "skills");

  // Check if source skills directory exists
  if (!existsSync(skillsSourceDir)) {
    p.log.error(`Skills directory not found: ${skillsSourceDir}`);
    p.log.info("Make sure you're running this from the AgentRouter package.");
    p.outro(color.red("Installation failed"));
    process.exit(1);
  }

  // Get list of skill files
  const skillFiles = await getSkillFiles(skillsSourceDir);

  if (skillFiles.length === 0) {
    p.log.warn("No skill files found in the skills/ directory.");
    p.outro(color.yellow("Nothing to install"));
    return;
  }

  // Create destination directory
  const spinner = p.spinner();
  spinner.start(`Installing skills to ${color.dim("~/.claude/skills/agent-router/")}`);

  try {
    // Create destination directory if it doesn't exist
    if (!existsSync(SKILLS_DEST_DIR)) {
      await mkdir(SKILLS_DEST_DIR, { recursive: true });
    }

    // Copy each skill file
    const installedSkills: string[] = [];
    const errors: Array<{ file: string; error: string }> = [];

    for (const file of skillFiles) {
      const sourcePath = join(skillsSourceDir, file);
      const destPath = join(SKILLS_DEST_DIR, file);

      try {
        // Verify source file exists and is readable
        await stat(sourcePath);
        await copyFile(sourcePath, destPath);
        installedSkills.push(file);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ file, error: message });
      }
    }

    spinner.stop("Skills installed");

    // Show results
    if (installedSkills.length > 0) {
      console.log();
      for (const file of installedSkills) {
        console.log(`  ${color.green("✓")} ${file}`);
      }
    }

    if (errors.length > 0) {
      console.log();
      p.log.warn("Some skills failed to install:");
      for (const { file, error } of errors) {
        console.log(`  ${color.red("✗")} ${file}: ${color.dim(error)}`);
      }
    }

    // Success message
    if (installedSkills.length > 0) {
      p.outro(color.green(`${installedSkills.length} skill${installedSkills.length === 1 ? "" : "s"} installed successfully!`));

      console.log();
      console.log(color.dim("  Restart Claude Code to use:"));
      for (const file of installedSkills) {
        console.log(`  ${color.cyan(getSkillCommand(file))}`);
      }
      console.log();
    } else {
      p.outro(color.yellow("No skills were installed"));
    }
  } catch (err) {
    spinner.stop("Installation failed");

    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("EACCES") || message.includes("permission")) {
      p.log.error("Permission denied. Unable to create skills directory.");
      p.log.info(`Try running with elevated permissions or manually create:\n  ${SKILLS_DEST_DIR}`);
    } else {
      p.log.error(`Failed to install skills: ${message}`);
    }

    p.outro(color.red("Installation failed"));
    process.exit(1);
  }
}

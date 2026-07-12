import matter from "gray-matter";
import {
  SkillFrontmatterSchema,
  type SkillFrontmatter,
  type SkillSpec,
} from "./schema.js";

/**
 * SKILL.md <-> SkillSpec serialization.
 *
 * The skill is the literal text the agent loads, so the ed25519 signature
 * commits to `serializeSkill(spec)` (trimmed) — never to a re-serialization
 * on verify. That makes a forged skill tamper-evident: edit the SKILL.md and
 * `capforge verify` reports signature-invalid.
 */

/** Serialize a SkillSpec to SKILL.md text (frontmatter YAML + body). */
export function serializeSkill(spec: SkillSpec): string {
  const data: SkillFrontmatter = {
    name: spec.frontmatter.name,
    description: spec.frontmatter.description,
    tools: spec.frontmatter.tools,
  };
  return matter.stringify(spec.body, data);
}

/** Parse frontmatter + body from SKILL.md text. Body is returned as-is. */
export function parseSkillMarkdown(md: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const { data, content } = matter(md);
  return {
    frontmatter: SkillFrontmatterSchema.parse(data),
    body: content.replace(/^\n+/, ""),
  };
}

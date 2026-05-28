import { db } from './db'

/** 12 root topics — hand-picked, seeded once on startup. */
export const ROOT_TOPICS = [
  'Psychology',
  'History',
  'Biology',
  'Space',
  'Technology',
  'Philosophy',
  'Mathematics',
  'Mythology',
  'Ancient Civilizations',
  'Economics',
  'Medicine',
  'Animals',
] as const

/** Idempotent: ensures the 12 root TopicNodes exist with depth 0. */
export async function seedRootTopics(): Promise<void> {
  for (const name of ROOT_TOPICS) {
    const existing = await db.topicNode.findUnique({ where: { name } })
    if (existing) continue
    await db.topicNode.create({ data: { name, depth: 0, parentId: null } })
  }
}

/** Get-or-create a node under a parent, at the given depth. */
export async function upsertNode(
  name: string,
  depth: number,
  parentId: string | null,
) {
  const trimmed = name.trim()
  const existing = await db.topicNode.findFirst({ where: { name: trimmed, parentId } })
  if (existing) return existing

  // Resolve name collisions against the unique index by suffixing with depth.
  const clash = await db.topicNode.findUnique({ where: { name: trimmed } })
  const finalName = clash ? `${trimmed} (${depth})` : trimmed

  try {
    return await db.topicNode.create({ data: { name: finalName, depth, parentId } })
  } catch (e: unknown) {
    // Lost the race — another concurrent request created the same node first.
    if ((e as { code?: string }).code === 'P2002') {
      const winner = await db.topicNode.findFirst({ where: { name: finalName, parentId } })
        ?? await db.topicNode.findFirst({ where: { name: trimmed, parentId } })
      if (winner) return winner
    }
    throw e
  }
}

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

    const node = await db.topicNode.create({
      data: { name, depth: 0, parentId: null },
    })
    await db.categoryArm.create({
      data: { nodeId: node.id, alpha: 1.0, beta: 1.0, totalPulls: 0 },
    })
  }
}

/** Look up a node by name (case-insensitive trim). */
export async function findNodeByName(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return null
  return db.topicNode.findFirst({
    where: { name: { equals: trimmed } },
  })
}

/** Get-or-create a node under a parent, with the given depth. */
export async function upsertNode(
  name: string,
  depth: number,
  parentId: string | null,
) {
  const trimmed = name.trim()
  const existing = await db.topicNode.findFirst({
    where: { name: trimmed, parentId },
  })
  if (existing) return existing

  // Avoid collisions on the unique `name` index by suffixing when needed.
  const clash = await db.topicNode.findUnique({ where: { name: trimmed } })
  const finalName = clash ? `${trimmed} (${depth})` : trimmed

  const node = await db.topicNode.create({
    data: { name: finalName, depth, parentId },
  })
  await db.categoryArm.create({
    data: { nodeId: node.id, alpha: 1.0, beta: 1.0, totalPulls: 0 },
  })
  return node
}

/** Direct children of a node, ordered by alpha desc (most engaged first). */
export async function getChildren(parentId: string) {
  return db.topicNode.findMany({
    where: { parentId },
    include: { arm: true },
    orderBy: { name: 'asc' },
  })
}

import type { Comment, CommentStatus } from './types.js';

export function countByStatus(comments: readonly Comment[]): Record<CommentStatus, number> {
  const counts: Record<CommentStatus, number> = {
    open: 0,
    addressed: 0,
    orphaned: 0,
    resolved: 0,
  };
  for (const comment of comments) counts[comment.status] += 1;
  return counts;
}

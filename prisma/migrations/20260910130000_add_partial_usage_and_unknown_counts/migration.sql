-- AlterEnum
ALTER TYPE "AiUsageSource" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "user_usage_summaries"
ADD COLUMN "unknown_input_call_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unknown_output_call_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "conversation_usage_summaries"
ADD COLUMN "unknown_input_call_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unknown_output_call_count" INTEGER NOT NULL DEFAULT 0;

-- Backfill unknown breakdown counts from existing usage records
UPDATE "user_usage_summaries" AS summary
SET
    "unknown_input_call_count" = counts."unknown_input_count",
    "unknown_output_call_count" = counts."unknown_output_count"
FROM (
    SELECT
        "user_id",
        COUNT(*) FILTER (WHERE "input_tokens" IS NULL)::INTEGER AS "unknown_input_count",
        COUNT(*) FILTER (WHERE "output_tokens" IS NULL)::INTEGER AS "unknown_output_count"
    FROM "ai_usage_records"
    GROUP BY "user_id"
) AS counts
WHERE summary."user_id" = counts."user_id";

UPDATE "conversation_usage_summaries" AS summary
SET
    "unknown_input_call_count" = counts."unknown_input_count",
    "unknown_output_call_count" = counts."unknown_output_count"
FROM (
    SELECT
        "conversation_id",
        COUNT(*) FILTER (WHERE "input_tokens" IS NULL)::INTEGER AS "unknown_input_count",
        COUNT(*) FILTER (WHERE "output_tokens" IS NULL)::INTEGER AS "unknown_output_count"
    FROM "ai_usage_records"
    WHERE "conversation_id" IS NOT NULL
    GROUP BY "conversation_id"
) AS counts
WHERE summary."conversation_id" = counts."conversation_id";

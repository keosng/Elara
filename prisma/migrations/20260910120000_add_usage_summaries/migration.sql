-- CreateTable
CREATE TABLE "user_usage_summaries" (
    "user_id" UUID NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_usage_summaries_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "conversation_usage_summaries" (
    "conversation_id" UUID NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_usage_summaries_pkey" PRIMARY KEY ("conversation_id")
);

-- Backfill summaries from existing usage records
INSERT INTO "user_usage_summaries" (
    "user_id",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "call_count",
    "created_at",
    "updated_at"
)
SELECT
    "user_id",
    COALESCE(SUM(COALESCE("input_tokens", 0)), 0)::INTEGER,
    COALESCE(SUM(COALESCE("output_tokens", 0)), 0)::INTEGER,
    COALESCE(SUM(COALESCE("total_tokens", 0)), 0)::INTEGER,
    COUNT(*)::INTEGER,
    MIN("created_at"),
    MAX("created_at")
FROM "ai_usage_records"
GROUP BY "user_id";

INSERT INTO "conversation_usage_summaries" (
    "conversation_id",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "call_count",
    "created_at",
    "updated_at"
)
SELECT
    "conversation_id",
    COALESCE(SUM(COALESCE("input_tokens", 0)), 0)::INTEGER,
    COALESCE(SUM(COALESCE("output_tokens", 0)), 0)::INTEGER,
    COALESCE(SUM(COALESCE("total_tokens", 0)), 0)::INTEGER,
    COUNT(*)::INTEGER,
    MIN("created_at"),
    MAX("created_at")
FROM "ai_usage_records"
WHERE "conversation_id" IS NOT NULL
GROUP BY "conversation_id";

-- AddForeignKey
ALTER TABLE "user_usage_summaries" ADD CONSTRAINT "user_usage_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_usage_summaries" ADD CONSTRAINT "conversation_usage_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

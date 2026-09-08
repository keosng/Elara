/*
  Warnings:

  - You are about to drop the column `summary` on the `conversations` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "messages_conversation_id_created_at_idx";

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "summary";

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "sequence" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "conversation_summaries" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "through_sequence" INTEGER NOT NULL DEFAULT 0,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_summaries_conversation_id_key" ON "conversation_summaries"("conversation_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sequence_idx" ON "messages"("conversation_id", "sequence");

-- AddForeignKey
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

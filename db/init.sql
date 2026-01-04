DROP TABLE IF EXISTS "ai_participants";
CREATE TABLE "public"."ai_participants" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "conversation_id" uuid,
    "model_name" character varying(255) NOT NULL,
    "model_provider" character varying(50) NOT NULL,
    "personality_name" character varying(100) NOT NULL,
    "system_instruction" text,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_participants_pkey" PRIMARY KEY ("id")
) WITH (oids = false);


DROP TABLE IF EXISTS "conversations";
CREATE TABLE "public"."conversations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "title" character varying(255) NOT NULL,
    "topic" text,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP,
    "is_active" boolean DEFAULT false,
    "message_limit" integer DEFAULT '0',
    "message_count" integer DEFAULT '0',
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_conversations_created_at" ON "public"."conversations" USING btree ("created_at" DESC);


DROP TABLE IF EXISTS "messages";
CREATE TABLE "public"."messages" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "conversation_id" uuid,
    "sender_type" character varying(20) NOT NULL,
    "sender_name" character varying(100),
    "model_name" character varying(255),
    "content" text NOT NULL,
    "created_at" timestamp DEFAULT CURRENT_TIMESTAMP,
    "message_order" integer NOT NULL,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
) WITH (oids = false);

CREATE INDEX "idx_messages_conversation_id" ON "public"."messages" USING btree ("conversation_id");

CREATE INDEX "idx_messages_order" ON "public"."messages" USING btree ("conversation_id", "message_order");


ALTER TABLE ONLY "public"."ai_participants" ADD CONSTRAINT "ai_participants_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT DEFERRABLE;

ALTER TABLE ONLY "public"."messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT DEFERRABLE;

-- 2026-01-03 03:13:21.571791+00

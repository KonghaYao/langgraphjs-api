SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gin; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA public;


--
-- Name: EXTENSION btree_gin; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gin IS 'support for indexing common datatypes in GIN';


--
-- Name: ltree; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS ltree WITH SCHEMA public;


--
-- Name: EXTENSION ltree; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION ltree IS 'data type for hierarchical tree-like structures';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assistant; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assistant (
    assistant_id uuid DEFAULT gen_random_uuid() NOT NULL,
    graph_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    name text,
    description text
);


ALTER TABLE public.assistant OWNER TO postgres;

--
-- Name: assistant_versions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assistant_versions (
    assistant_id uuid NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    graph_id text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    name text
);


ALTER TABLE public.assistant_versions OWNER TO postgres;

--
-- Name: checkpoint_blobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checkpoint_blobs (
    thread_id uuid NOT NULL,
    channel text NOT NULL,
    version text NOT NULL,
    type text NOT NULL,
    blob bytea,
    checkpoint_ns text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.checkpoint_blobs OWNER TO postgres;

--
-- Name: checkpoint_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checkpoint_migrations (
    v integer NOT NULL
);


ALTER TABLE public.checkpoint_migrations OWNER TO postgres;

--
-- Name: checkpoint_writes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checkpoint_writes (
    thread_id uuid NOT NULL,
    checkpoint_id uuid NOT NULL,
    task_id uuid NOT NULL,
    idx integer NOT NULL,
    channel text NOT NULL,
    type text NOT NULL,
    blob bytea NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.checkpoint_writes OWNER TO postgres;

--
-- Name: checkpoints; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checkpoints (
    thread_id uuid NOT NULL,
    checkpoint_id uuid NOT NULL,
    run_id uuid,
    parent_checkpoint_id uuid,
    checkpoint jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    checkpoint_ns text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.checkpoints OWNER TO postgres;

--
-- Name: cron; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cron (
    cron_id uuid DEFAULT gen_random_uuid() NOT NULL,
    assistant_id uuid,
    thread_id uuid,
    user_id text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    schedule text NOT NULL,
    next_run_date timestamp with time zone,
    end_time timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.cron OWNER TO postgres;

--
-- Name: run; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.run (
    run_id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    assistant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    kwargs jsonb NOT NULL,
    multitask_strategy text DEFAULT 'reject'::text NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50', autovacuum_analyze_scale_factor='0.01', autovacuum_analyze_threshold='50');


ALTER TABLE public.run OWNER TO postgres;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.schema_migrations (
    version bigint NOT NULL,
    dirty boolean NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO postgres;

--
-- Name: store; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.store (
    prefix text NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamp with time zone,
    ttl_minutes integer
);


ALTER TABLE public.store OWNER TO postgres;

--
-- Name: thread; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.thread (
    thread_id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'idle'::text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    "values" jsonb,
    interrupts jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.thread OWNER TO postgres;

--
-- Name: thread_ttl; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.thread_ttl (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    strategy text DEFAULT 'delete'::text NOT NULL,
    ttl_minutes numeric NOT NULL,
    created_at timestamp without time zone DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text) NOT NULL,
    expires_at timestamp without time zone GENERATED ALWAYS AS ((created_at + ((ttl_minutes)::double precision * '00:01:00'::interval))) STORED,
    CONSTRAINT thread_ttl_ttl_minutes_check CHECK ((ttl_minutes >= (0)::numeric))
);


ALTER TABLE public.thread_ttl OWNER TO postgres;

--
-- Name: assistant assistant_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant
    ADD CONSTRAINT assistant_pkey PRIMARY KEY (assistant_id);


--
-- Name: assistant_versions assistant_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_versions
    ADD CONSTRAINT assistant_versions_pkey PRIMARY KEY (assistant_id, version);


--
-- Name: checkpoint_blobs checkpoint_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoint_blobs
    ADD CONSTRAINT checkpoint_blobs_pkey PRIMARY KEY (thread_id, checkpoint_ns, channel, version);


--
-- Name: checkpoint_migrations checkpoint_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoint_migrations
    ADD CONSTRAINT checkpoint_migrations_pkey PRIMARY KEY (v);


--
-- Name: checkpoint_writes checkpoint_writes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx);


--
-- Name: checkpoints checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_pkey PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id);


--
-- Name: cron cron_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cron
    ADD CONSTRAINT cron_pkey PRIMARY KEY (cron_id);


--
-- Name: run run_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.run
    ADD CONSTRAINT run_pkey PRIMARY KEY (run_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: store store_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.store
    ADD CONSTRAINT store_pkey PRIMARY KEY (prefix, key);


--
-- Name: thread thread_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.thread
    ADD CONSTRAINT thread_pkey PRIMARY KEY (thread_id);


--
-- Name: thread_ttl thread_ttl_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.thread_ttl
    ADD CONSTRAINT thread_ttl_pkey PRIMARY KEY (id);


--
-- Name: assistant_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assistant_created_at_idx ON public.assistant USING btree (created_at DESC);


--
-- Name: assistant_graph_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assistant_graph_id_idx ON public.assistant USING btree (graph_id, created_at DESC);


--
-- Name: assistant_metadata_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX assistant_metadata_idx ON public.assistant USING gin (metadata jsonb_path_ops);


--
-- Name: checkpoints_checkpoint_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX checkpoints_checkpoint_id_idx ON public.checkpoints USING btree (thread_id, checkpoint_id DESC);


--
-- Name: checkpoints_run_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX checkpoints_run_id_idx ON public.checkpoints USING btree (run_id);


--
-- Name: idx_store_expires_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_store_expires_at ON public.store USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: idx_thread_ttl_expires_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_thread_ttl_expires_at ON public.thread_ttl USING btree (expires_at);


--
-- Name: idx_thread_ttl_thread_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_thread_ttl_thread_id ON public.thread_ttl USING btree (thread_id);


--
-- Name: idx_thread_ttl_thread_strategy; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_thread_ttl_thread_strategy ON public.thread_ttl USING btree (thread_id, strategy);


--
-- Name: run_assistant_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX run_assistant_id_idx ON public.run USING btree (assistant_id);


--
-- Name: run_metadata_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX run_metadata_idx ON public.run USING gin (thread_id, metadata jsonb_path_ops);


--
-- Name: run_pending_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX run_pending_idx ON public.run USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: run_thread_id_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX run_thread_id_status_idx ON public.run USING btree (thread_id, status);


--
-- Name: store_prefix_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX store_prefix_idx ON public.store USING btree (prefix text_pattern_ops);


--
-- Name: thread_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX thread_created_at_idx ON public.thread USING btree (created_at DESC);


--
-- Name: thread_metadata_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX thread_metadata_idx ON public.thread USING gin (metadata jsonb_path_ops);


--
-- Name: thread_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX thread_status_idx ON public.thread USING btree (status, created_at DESC);


--
-- Name: thread_values_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX thread_values_idx ON public.thread USING gin ("values" jsonb_path_ops);


--
-- Name: assistant_versions assistant_versions_assistant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assistant_versions
    ADD CONSTRAINT assistant_versions_assistant_id_fkey FOREIGN KEY (assistant_id) REFERENCES public.assistant(assistant_id) ON DELETE CASCADE;


--
-- Name: checkpoint_blobs checkpoint_blobs_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoint_blobs
    ADD CONSTRAINT checkpoint_blobs_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.thread(thread_id) ON DELETE CASCADE;


--
-- Name: checkpoint_writes checkpoint_writes_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoint_writes
    ADD CONSTRAINT checkpoint_writes_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.thread(thread_id) ON DELETE CASCADE;


--
-- Name: checkpoints checkpoints_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.run(run_id) ON DELETE CASCADE;


--
-- Name: checkpoints checkpoints_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checkpoints
    ADD CONSTRAINT checkpoints_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.thread(thread_id) ON DELETE CASCADE;


--
-- Name: cron cron_assistant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cron
    ADD CONSTRAINT cron_assistant_id_fkey FOREIGN KEY (assistant_id) REFERENCES public.assistant(assistant_id) ON DELETE CASCADE;


--
-- Name: cron cron_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cron
    ADD CONSTRAINT cron_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.thread(thread_id) ON DELETE CASCADE;


--
-- Name: run run_assistant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.run
    ADD CONSTRAINT run_assistant_id_fkey FOREIGN KEY (assistant_id) REFERENCES public.assistant(assistant_id) ON DELETE CASCADE;


--
-- Name: run run_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.run
    ADD CONSTRAINT run_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.thread(thread_id) ON DELETE CASCADE;


--
-- Name: thread_ttl thread_ttl_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.thread_ttl
    ADD CONSTRAINT thread_ttl_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.thread(thread_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


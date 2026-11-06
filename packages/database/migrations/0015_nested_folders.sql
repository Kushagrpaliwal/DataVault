-- Folders become a tree.
--
-- A folder can sit inside another folder now, so the grouping inside a folder
-- is a folder of its own rather than a separate kind of thing. The
-- collections that were used for that grouping become folders, so nothing is
-- lost and nothing has to be done by hand.

ALTER TABLE "vaults" ADD COLUMN "parent_id" uuid;
--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_parent_id_vaults_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."vaults"("id") ON DELETE cascade ON UPDATE no action;

-- The old rule was one name per workspace. A name now only has to be apart
-- from the names of its siblings, so the old index is dropped here and the
-- new one is made at the end, once the folders that are being converted are
-- in place.
DROP INDEX "vaults_org_slug_unique";

-- Every collection becomes a folder inside the folder it belonged to.
--
-- The address of a folder only has to be apart from the addresses of its
-- siblings, so a name that is already taken by a sibling is given a number
-- at the end.
CREATE TEMPORARY TABLE "collection_folder" (
	"collection_id" uuid PRIMARY KEY,
	"folder_id" uuid NOT NULL
);
--> statement-breakpoint
DO $$
DECLARE
	collection record;
	base_slug text;
	new_slug text;
	suffix integer;
	new_folder_id uuid;
BEGIN
	FOR collection IN
		SELECT id, organization_id, vault_id, name, color, created_by, created_at, updated_at
		FROM vault_collections
		ORDER BY vault_id, name
	LOOP
		base_slug := lower(regexp_replace(trim(collection.name), '[^a-zA-Z0-9]+', '-', 'g'));
		base_slug := regexp_replace(base_slug, '^-+|-+$', '', '');
		IF base_slug = '' THEN
			base_slug := 'folder';
		END IF;
		new_slug := base_slug;
		suffix := 1;
		WHILE EXISTS (
			SELECT 1 FROM vaults sibling
			WHERE sibling.organization_id = collection.organization_id
				AND sibling.parent_id = collection.vault_id
				AND sibling.slug = new_slug
		) LOOP
			suffix := suffix + 1;
			new_slug := base_slug || '-' || suffix;
		END LOOP;
		INSERT INTO vaults (organization_id, parent_id, name, slug, kind, color, is_default, created_by, created_at, updated_at)
		VALUES (
			collection.organization_id,
			collection.vault_id,
			collection.name,
			new_slug,
			(SELECT kind FROM vaults WHERE id = collection.vault_id),
			collection.color,
			false,
			collection.created_by,
			collection.created_at,
			collection.updated_at
		)
		RETURNING id INTO new_folder_id;
		INSERT INTO collection_folder (collection_id, folder_id) VALUES (collection.id, new_folder_id);
	END LOOP;
END $$;

-- The items go into the folder that replaced their collection.
--
-- An item that was in more than one collection goes into the first of them
-- by name, because an item lives in one folder. An item that was in a
-- collection of a folder it is not in is left where it is.
UPDATE saved_records record
SET vault_id = chosen.folder_id, updated_at = now()
FROM (
	SELECT DISTINCT ON (link.saved_record_id)
		link.saved_record_id AS saved_record_id,
		mapping.folder_id AS folder_id,
		collection.vault_id AS collection_vault_id
	FROM saved_record_collections link
	JOIN vault_collections collection ON collection.id = link.collection_id
	JOIN collection_folder mapping ON mapping.collection_id = link.collection_id
	ORDER BY link.saved_record_id, collection.name
) chosen
WHERE record.id = chosen.saved_record_id
	AND record.vault_id = chosen.collection_vault_id;
--> statement-breakpoint
DROP TABLE "collection_folder";

-- A name only has to be apart from the names of its siblings.
--
-- The parent is folded into the index with coalesce, because PostgreSQL
-- treats a null as different from every other null, and two folders at the
-- top would otherwise be allowed to share a name.
CREATE UNIQUE INDEX "vaults_sibling_slug_unique" ON "vaults" USING btree ("organization_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),"slug");
--> statement-breakpoint
CREATE INDEX "vaults_org_parent_idx" ON "vaults" USING btree ("organization_id","parent_id");

-- The collections are not used any more.
ALTER TABLE "saved_record_collections" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vault_collections" DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP TABLE "saved_record_collections" CASCADE;
--> statement-breakpoint
DROP TABLE "vault_collections" CASCADE;

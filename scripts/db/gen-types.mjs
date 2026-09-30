// Generates src/lib/supabase/types.ts (the `Database` type supabase-js is parameterised
// with) from a live Postgres schema, in the same shape `supabase gen types typescript`
// produces. Use the Supabase CLI instead when it is available; this exists so types can
// be regenerated against the Docker-free local stack too.
//
//   DATABASE_URL=postgres://... npm run db:types
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dbUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
const outFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/lib/supabase/types.ts");

function query(sql) {
  const out = execFileSync(
    "psql",
    [dbUrl, "-X", "-tA", "-c", `select coalesce(json_agg(t), '[]') from (${sql}) t`],
    {
      encoding: "utf8",
      env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" },
    },
  );
  return JSON.parse(out.trim());
}

const columns = query(`
  select c.table_name, c.column_name, c.is_nullable = 'YES' as nullable, c.column_default is not null as has_default,
         c.is_generated = 'ALWAYS' or c.is_identity = 'YES' and c.identity_generation = 'ALWAYS' as generated,
         c.data_type, c.udt_name, c.ordinal_position
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by c.table_name, c.ordinal_position`);

// Views are read-only; like the Supabase CLI, every view column is typed nullable.
const viewColumns = query(`
  select c.table_name, c.column_name, c.data_type, c.udt_name
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and t.table_type = 'VIEW'
  order by c.table_name, c.ordinal_position`);

const enums = query(`
  select t.typname as name, json_agg(e.enumlabel order by e.enumsortorder) as values
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' group by t.typname order by t.typname`);

const fks = query(`
  select con.conname as name, src.relname as table_name, tgt.relname as referenced,
         (select json_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as columns,
         (select json_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord)
            join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as referenced_columns,
         exists (
           select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique and i.indpred is null
             and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x) = (select array_agg(x order by x) from unnest(con.conkey) x)
         ) as one_to_one
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  where con.contype = 'f' and n.nspname = 'public' and tgt.relnamespace = n.oid
  order by src.relname, con.conname`);

const functions = query(`
  select p.proname as name, pg_get_function_result(p.oid) as result,
         coalesce((select json_agg(json_build_object('name', a.name, 'type', format_type(a.type, null)) order by a.ord)
                   from unnest(p.proargnames, p.proargtypes::oid[]) with ordinality a(name, type, ord)), '[]') as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and pg_get_function_result(p.oid) <> 'trigger'
  order by p.proname`);

const enumNames = new Set(enums.map((e) => e.name));

function tsType(dataType, udt) {
  if (dataType === "ARRAY") return `${tsType(udtToDataType(udt.slice(1)), udt.slice(1))}[]`;
  if (dataType === "USER-DEFINED" && enumNames.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  return scalar(dataType);
}
function udtToDataType(udt) {
  return (
    { text: "text", uuid: "uuid", int2: "smallint", int4: "integer", int8: "bigint", bool: "boolean" }[udt] ??
    udt
  );
}
function scalar(type) {
  switch (type) {
    case "smallint":
    case "integer":
    case "bigint":
    case "numeric":
    case "real":
    case "double precision":
    case "int2":
    case "int4":
    case "int8":
      return "number";
    case "boolean":
    case "bool":
      return "boolean";
    case "json":
    case "jsonb":
      return "Json";
    default:
      return "string";
  }
}

const tables = new Map();
for (const c of columns) {
  if (!tables.has(c.table_name)) tables.set(c.table_name, []);
  tables.get(c.table_name).push(c);
}

const indent = (n) => " ".repeat(n);
let out = `// Generated by scripts/db/gen-types.mjs from the migrations in supabase/migrations.
// Do not edit by hand; run \`npm run db:types\` against a migrated database instead.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
`;
for (const [name, cols] of tables) {
  const row = cols.map(
    (c) => `${indent(10)}${c.column_name}: ${tsType(c.data_type, c.udt_name)}${c.nullable ? " | null" : ""};`,
  );
  const insert = cols
    .filter((c) => !c.generated)
    .map(
      (c) =>
        `${indent(10)}${c.column_name}${c.nullable || c.has_default ? "?" : ""}: ${tsType(c.data_type, c.udt_name)}${c.nullable ? " | null" : ""};`,
    );
  const update = cols
    .filter((c) => !c.generated)
    .map(
      (c) =>
        `${indent(10)}${c.column_name}?: ${tsType(c.data_type, c.udt_name)}${c.nullable ? " | null" : ""};`,
    );
  const rels = fks
    .filter((f) => f.table_name === name)
    .map(
      (f) => `${indent(10)}{
${indent(12)}foreignKeyName: "${f.name}";
${indent(12)}columns: ${JSON.stringify(f.columns)};
${indent(12)}isOneToOne: ${f.one_to_one};
${indent(12)}referencedRelation: "${f.referenced}";
${indent(12)}referencedColumns: ${JSON.stringify(f.referenced_columns)};
${indent(10)}},`,
    );
  out += `${indent(6)}${name}: {
${indent(8)}Row: {
${row.join("\n")}
${indent(8)}};
${indent(8)}Insert: {
${insert.join("\n")}
${indent(8)}};
${indent(8)}Update: {
${update.join("\n")}
${indent(8)}};
${indent(8)}Relationships: [
${rels.join("\n")}
${indent(8)}];
${indent(6)}};
`;
}
const views = new Map();
for (const c of viewColumns) {
  if (!views.has(c.table_name)) views.set(c.table_name, []);
  views.get(c.table_name).push(c);
}
out += `    };
    Views: {
`;
for (const [name, cols] of views) {
  out += `${indent(6)}${name}: {
${indent(8)}Row: {
${cols.map((c) => `${indent(10)}${c.column_name}: ${tsType(c.data_type, c.udt_name)} | null;`).join("\n")}
${indent(8)}};
${indent(8)}Relationships: [];
${indent(6)}};
`;
}
out += `    };
    Functions: {
`;
for (const f of functions) {
  const args = f.args.filter((a) => a.name);
  const argsType = args.length
    ? `{ ${args.map((a) => `${a.name}: ${scalar(a.type)}`).join("; ")} }`
    : "Record<PropertyKey, never>";
  const result = f.result === "void" ? "undefined" : scalar(f.result);
  out += `${indent(6)}${f.name}: { Args: ${argsType}; Returns: ${result} };\n`;
}
out += `    };
    Enums: {
`;
for (const e of enums) {
  out += `${indent(6)}${e.name}: ${e.values.map((v) => JSON.stringify(v)).join(" | ")};\n`;
}
out += `    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Views<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
`;
writeFileSync(outFile, out);
console.log(
  `wrote ${path.relative(process.cwd(), outFile)} (${tables.size} tables, ${views.size} views, ${enums.length} enums, ${functions.length} functions)`,
);

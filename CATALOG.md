# PTF Catalogs

Version 0.1 (draft). How a library publishes its content so that tutor hosts can
find, download, verify and share it, publicly or behind a login.

A **library** publishes content. A **catalog** is the library's public face: one
JSON file that lists its packages, says where the files are and how to log in.
A **host** (a tutor server such as Magister, or the local MCP server) connects any
number of catalogs, stores the packages and teaches from them. A library needs no
MCP server and no tutor; a web server that hands out files is enough.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 1. The catalog file

A catalog is a JSON document, conventionally `ptf-catalog.json` at the root of the
library. Its URL is the catalog's address. A host given a URL that does not end in
`.json` appends `/ptf-catalog.json`.

```json
{
  "ptf_catalog": "0.1",
  "id": "io.github.kaproblem.ptf-library",
  "title": "PTF Library",
  "publisher": "KaProblem",
  "description": "Open courses for the Personal Tutor Format.",
  "homepage": "https://github.com/KaProblem/ptf-library",
  "auth": { "type": "none" },
  "cache": "shared",
  "snapshot": { "url": "https://codeload.github.com/KaProblem/ptf-library/tar.gz/refs/heads/main", "strip": 1 },
  "packages": [
    { "kind": "bundle", "id": "gravity", "version": "0.2.1", "title": "Gravity", "path": "bundles/gravity", "digest": "sha256-…" },
    { "kind": "sim", "id": "ptf:sim/falling-tower", "version": "1.1.1", "title": "The falling tower", "path": "sims/falling-tower/1.1.1", "digest": "sha256-…" }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `ptf_catalog` | yes | Version of this document format, `"0.1"`. |
| `id` | yes | Stable identifier of the catalog, lowercase reverse domain style (`at.uibk.physics`). Hosts key everything on it. |
| `title` | yes | Name shown to learners. |
| `publisher` | yes | Who is responsible for the content. |
| `description`, `homepage`, `contact` | no | Shown when a learner connects the catalog. |
| `auth` | yes | How to log in (§3). |
| `cache` | no | What a host may store (§4). Default `per-user`. |
| `recheck_hours` | no | How often a host must recheck a learner's access (§3.3). Default 24. |
| `snapshot` | no | One archive that holds every package (§2.2). |
| `packages` | yes | The packages this catalog offers to the requester (§2). |

`schemas/catalog.schema.json` is the normative schema.

## 2. Packages

Every entry of `packages` is one immutable package version.

| Field | Required | Meaning |
|---|---|---|
| `kind` | yes | `bundle`, `sim` or `code`. |
| `id` | yes | The bundle's `id` from `index.md`, or the full simulator or code lab id (`ptf:sim/<name>`, `ptf:code/<name>`). |
| `version` | yes | Semver. A bundle's `version` from `index.md` is REQUIRED for a bundle to be listed. |
| `title` | yes | Title from `index.md`, `sim.json` or `lab.json`. |
| `summary` | no | Description, for listings. |
| `path` | one of | Directory of the package inside the snapshot. |
| `archive` | one of | URL of a `.tar.gz` that holds the package's files at its root. Relative URLs resolve against the catalog URL. |
| `digest` | yes | Tree digest of the package directory (§2.1). |

### 2.1 Digest and immutability

`digest` uses the same algorithm as simulator `integrity` (SIMULATOR-SPEC.md §2),
but over **all** files of the package directory, the manifest included: list
every file by its `/`-separated path relative to the package directory (dot
files skipped), sort by bytes, concatenate `<path>\n<sha256 hex>\n` per file,
hash that text with SHA-256 and write `sha256-<base64>`.

- A published package version MUST NOT change. A new digest needs a new version.
- A host MUST verify the digest after unpacking and MUST reject a package whose
  files do not match. Simulators and code labs are additionally checked against
  their own `integrity`.
- Because content is immutable and addressed by digest, a host MAY store each
  digest once and serve it to every learner allowed to see it (§4).

### 2.2 Snapshot or per-package archives

A catalog delivers files in one of two ways, or both:

- `snapshot`: one `.tar.gz` with the whole library. `strip` is the number of
  leading path components to drop (1 for GitHub tarballs). Each package's `path`
  points into it. A snapshot URL MAY move (for example a branch tarball);
  hosts verify each package's digest and retry later on a mismatch.
- `archive` per package: suited to private catalogs that hand out only what a
  learner may see.

### 2.3 How hosts lay out packages

A host builds a library view from packages: bundles at `bundles/<id>/`,
simulators at `sims/<name>/<version>/`, code labs at `code/<name>/<version>/`,
where `<name>` is the id without its `ptf:sim/` or `ptf:code/` prefix. References
in a bundle resolve in this view as in SPEC.md §3. Simulators that live inside a
bundle directory travel with the bundle and need no own entry.

Two catalogs MAY offer the same id. A host MUST NOT mix versions of one id from
different catalogs silently; it keeps the catalog that was connected first and
reports the conflict.

## 3. Access

### 3.1 Auth types

| `auth.type` | How a host logs in |
|---|---|
| `none` | No login. |
| `bearer` | The learner gets an access key from the library (for example in its portal) and gives it to the host. The host sends `Authorization: Bearer <key>`. `auth.instructions` (text) and `auth.url` (page to get a key) tell the learner how. |
| `oauth2` | Reserved for OAuth 2.0 (authorization code with PKCE for web hosts, device authorization for local hosts) with `authorization_endpoint`, `token_endpoint`, optional `device_authorization_endpoint` and `scope` (default `ptf.catalog.read`). Hosts MAY not support it yet. |

A host MUST send credentials only to the origin of the catalog URL. Snapshot and
archive URLs on another origin are fetched without credentials.

### 3.2 The listing is the access

With a login, the catalog answers per learner and lists only the packages that
learner may use. A host shows a learner only the packages its last successful
listing for that learner contained. Archives SHOULD enforce the same rule.

### 3.3 Rechecking and revocation

A host MUST fetch the listing again with the learner's credentials when the
learner logs in to the host and at least every `recheck_hours`. Catalogs SHOULD
answer with `ETag` and honour `If-None-Match`, so a recheck is usually a `304`.
On `401` or `403` the host MUST hide the catalog's packages from that learner at
once and tell the learner to reconnect.

### 3.4 No learner data

A catalog learns that a learner fetched its listing, nothing else. Hosts MUST NOT
send learner records, progress or profile data to a catalog.

## 4. What a host may store

| `cache` | Meaning |
|---|---|
| `shared` | Store each package once and serve it to every learner of the host whose access the catalog confirmed (for `auth: none`, every learner). |
| `per-user` | Store per learner; delete a learner's copy when access ends. A host that stores by digest MAY keep one copy while at least one learner with access remains. |
| `none` | Fetch on demand for the current session; do not store beyond it. |

## 5. Checking imported content

A host SHOULD check a package before it shows it: digest and integrity (§2.1),
the frontmatter and manifests against the schemas, and simulator code against the
forbidden patterns of SIMULATOR-SPEC.md §5.2. A host MUST NOT show a simulator
that fails these checks. `ptf-check` does all of this for a whole library.

## 6. Tools

- `ptf-check catalog [--write] <library-root>` regenerates `packages` of
  `<library-root>/ptf-catalog.json` from the library and keeps every other
  field; without `--write` it prints the result. When the file is missing it
  starts from a skeleton (`auth: none`, `cache: shared`) to fill in.
- `ptf-check <library-root>` validates an existing `ptf-catalog.json` against the
  schema and fails when a listed package is missing, its digest differs, or a
  bundle, simulator or code lab is not listed.

# Python source removal

Removed project-owned `.py` files, obsolete Python launch scripts and dependency manifests. Kept Vue/JavaScript/TypeScript, SQL, firmware and private database backups. The optional recovery archive could not be created. Git-tracked files remain recoverable through Git; no recovery archive is claimed.

The web app runs through Vue and Node.js. Removed face recognition, AI and serial tooling has no replacement implementation in this change. JavaScript API clients and security checks remain; they must not report unavailable recognition services as working.

Third-party files inside ignored virtual environments and local tooling are not application source and were excluded from deletion.

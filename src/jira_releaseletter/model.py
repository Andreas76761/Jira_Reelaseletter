"""Gemeinsames Ticket-Datenmodell, unabhängig vom Quellformat."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Comment:
    author: str | None = None
    created: str | None = None
    body: str = ""


@dataclass
class Ticket:
    key: str
    summary: str = ""
    issue_type: str | None = None
    status: str | None = None
    priority: str | None = None
    project: str | None = None
    resolution: str | None = None
    assignee: str | None = None
    reporter: str | None = None
    created: str | None = None
    updated: str | None = None
    labels: list[str] = field(default_factory=list)
    components: list[str] = field(default_factory=list)
    fix_versions: list[str] = field(default_factory=list)
    description: str = ""
    comments: list[Comment] = field(default_factory=list)
    watchers: list[str] = field(default_factory=list)
    custom_fields: dict[str, str] = field(default_factory=dict)

    # Diagnose-Info, nicht Teil der Jira-Daten selbst.
    source_file: str | None = None
    warnings: list[str] = field(default_factory=list)

    def as_field_dict(self) -> dict[str, object]:
        """Alle inhaltlichen Felder als Dict, für Bereinigung/Export."""
        return {
            "key": self.key,
            "summary": self.summary,
            "issue_type": self.issue_type,
            "status": self.status,
            "priority": self.priority,
            "project": self.project,
            "resolution": self.resolution,
            "assignee": self.assignee,
            "reporter": self.reporter,
            "created": self.created,
            "updated": self.updated,
            "labels": self.labels,
            "components": self.components,
            "fix_versions": self.fix_versions,
            "description": self.description,
            "comments": self.comments,
            "watchers": self.watchers,
            "custom_fields": self.custom_fields,
        }

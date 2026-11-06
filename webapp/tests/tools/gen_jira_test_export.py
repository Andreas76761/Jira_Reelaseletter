#!/usr/bin/env python3
"""Erzeugt einen synthetischen Jira-XML-Export (Struktur wie ein echter Export aus Jira Server 10.x,
vgl. fixtures/real_jira_export_sample.xml) fuer Last- und Funktionstests des Ticket-Cockpits.
Alle Inhalte sind erfunden; Personen sind Platzhalter ("Test Person …"). Deterministisch (fester Seed).

Aufruf:  python3 gen_jira_test_export.py [Anzahl Tickets] [Ausgabedatei]
"""
import random, sys
from datetime import datetime, timedelta
from xml.sax.saxutils import escape

N = int(sys.argv[1]) if len(sys.argv) > 1 else 500
OUT = sys.argv[2] if len(sys.argv) > 2 else "ONESCM_Testexport_%d.xml" % N
rnd = random.Random(20261106)
PROJECT, BASE_KEY, BASE_ID = "ONESCM", 40000, 60000

DOMAINS = {
    "Vertragsverwaltung": ["Vertrag anlegen", "Vertragsänderung", "Kündigung", "Vertragsübersicht"],
    "Fahrzeugverwaltung": ["Fahrzeugstammdaten", "Laufleistung", "Fahrzeugrückgabe", "Zulassung"],
    "Kundenverwaltung": ["Kundenstammdaten", "Kundensuche", "Ansprechpartner", "Bonitätsprüfung"],
    "Revenue Management": ["Rechnungsstellung", "Gutschrift", "Mahnwesen", "Preisgestaltung"],
    "Zahlungsverkehr": ["SEPA-Lastschrift", "Zahlungseingang", "Rücklastschrift", "Zahlungsplan"],
    "Service & Wartung": ["Wartungsvertrag", "Werkstattauftrag", "Reifenservice", "Schadenmeldung"],
    "Reporting": ["Dashboard", "Export", "Monatsbericht", "Kennzahlen"],
}
COMPONENTS = ["oneSCM Frontend", "oneSCM Backend", "Schnittstellen", "Druck & Dokumente", "Berechtigungen"]
TYPES = [("Story", 10001, 0.48), ("Bug", 10004, 0.24), ("Task", 10002, 0.14), ("Epic", 10000, 0.06), ("Sub-task", 10003, 0.08)]
STATUSES = [("Fertig", "done", "success", 0.45), ("In Arbeit", "indeterminate", "inprogress", 0.2), ("In Test", "indeterminate", "inprogress", 0.12),
            ("Zu erledigen", "new", "default", 0.18), ("Abgebrochen", "done", "success", 0.05)]
PRIOS = [("Kritisch", 2, 0.06), ("Hoch", 3, 0.24), ("Mittel", 4, 0.5), ("Geringfügig", 5, 0.2)]
ROLES = ["Retail", "Fleet", "Backoffice", "Händler", "Administrator"]
VERSIONS = ["2026.4", "2026.5", "2026.6"]
SPRINTS = ["Sprint 15.%d- Caffeine Overflow" % i for i in range(1, 7)]
PEOPLE = ["Test Person %s" % n for n in ["Eins", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht"]]
VERBS = ["ermöglichen", "erweitern", "überarbeiten", "korrigieren", "vereinfachen", "automatisieren", "anzeigen", "prüfen"]
BUG_PHRASES = ["Fehlermeldung beim Speichern", "falscher Betrag in der Vorschau", "Feld bleibt leer nach dem Laden",
               "Sortierung der Liste falsch", "Timeout bei großer Datenmenge", "Umlaute im PDF fehlerhaft", "Doppelte Einträge nach Import"]

def pick(weighted):
    r, acc = rnd.random(), 0.0
    for item in weighted:
        acc += item[-1]
        if r <= acc:
            return item
    return weighted[-1]

def jdate(dt):
    return dt.strftime("%a, %-d %b %Y %H:%M:%S +0100")

start = datetime(2025, 9, 1, 9, 0)
tickets = []
for i in range(N):
    key_no = BASE_KEY + i
    tname, tid, _ = pick(TYPES)
    dom = rnd.choice(list(DOMAINS))
    feature = rnd.choice(DOMAINS[dom])
    status = pick(STATUSES)
    prio = pick(PRIOS)
    created = start + timedelta(days=rnd.randint(0, 400), minutes=rnd.randint(0, 600))
    updated = created + timedelta(days=rnd.randint(0, 60))
    role = rnd.sample(ROLES, rnd.randint(1, 2))
    if tname == "Bug":
        summary = "%s - %s: %s" % (dom, feature, rnd.choice(BUG_PHRASES))
    elif tname == "Epic":
        summary = "%s - %s grundlegend %s" % (dom, feature, rnd.choice(VERBS))
    else:
        summary = "%s - %s für %s %s" % (dom, feature, " und ".join(role), rnd.choice(VERBS))
    tickets.append(dict(i=i, key="%s-%d" % (PROJECT, key_no), id=BASE_ID + i, type=(tname, tid), dom=dom, feature=feature, status=status,
                        prio=prio, created=created, updated=updated, role=role, summary=summary))

epics = [t for t in tickets if t["type"][0] == "Epic"]
parents = [t for t in tickets if t["type"][0] in ("Story", "Task")]

def description(t):
    k = t["key"]
    paras = ["<p>Als %s möchte ich im Bereich <b>%s</b> (%s) effizienter arbeiten.</p>" % (" bzw. ".join(t["role"]), t["dom"], t["feature"])]
    if t["type"][0] == "Bug":
        paras.append("<p><b>Schritte:</b></p><ol><li>Maske „%s“ öffnen</li><li>Daten erfassen und speichern</li><li>%s</li></ol>" % (t["feature"], rnd.choice(BUG_PHRASES)))
        paras.append("<p><b>Erwartet:</b> Speichern ohne Fehler. <b>Tatsächlich:</b> siehe Screenshot.</p>")
    else:
        paras.append("<p><b>Akzeptanzkriterien:</b></p><ul><li>%s ist für %s sichtbar</li><li>Änderungen werden protokolliert</li><li>Berechtigung über Rolle „%s“</li></ul>"
                     % (t["feature"], t["role"][0], t["role"][0]))
    if rnd.random() < 0.3 and t["i"] > 0:
        paras.append("<p>Siehe auch %s.</p>" % tickets[rnd.randint(0, t["i"] - 1)]["key"])
    return "".join(paras)

def item(t):
    o = []
    a = o.append
    st, sk, sc, _ = t["status"]
    a("<item>")
    a("<title>[%s] %s</title>" % (t["key"], escape(t["summary"])))
    a("<link>https://jira.example.com/browse/%s</link>" % t["key"])
    a('<project id="10000" key="%s">DOT ONESCM</project>' % PROJECT)
    a("<description>%s</description>" % escape(description(t)))
    a("<environment/>")
    a('<key id="%d">%s</key>' % (t["id"], t["key"]))
    a("<summary>%s</summary>" % escape(t["summary"]))
    a('<type id="%d" iconUrl="https://jira.example.com/icon.png">%s</type>' % (t["type"][1], t["type"][0]))
    if t["type"][0] == "Sub-task" and parents:
        p = rnd.choice(parents)
        t["parent"] = p
        a('<parent id="%d">%s</parent>' % (p["id"], p["key"]))
    a('<priority id="%d" iconUrl="https://jira.example.com/p.svg">%s</priority>' % (t["prio"][1], t["prio"][0]))
    a('<status id="10001" iconUrl="https://jira.example.com/" description="">%s</status>' % st)
    a('<statusCategory id="3" key="%s" colorName="%s"/>' % (sk, sc))
    a('<resolution id="10000">%s</resolution>' % ("Fertig" if st == "Fertig" else ("Abgebrochen" if st == "Abgebrochen" else "Nicht erledigt")))
    ass, rep = rnd.choice(PEOPLE), rnd.choice(PEOPLE)
    a('<assignee username="tp%d">%s</assignee>' % (PEOPLE.index(ass), ass))
    a('<reporter username="tp%d">%s</reporter>' % (PEOPLE.index(rep), rep))
    labels = rnd.sample(["Van_FullGoLive_Scope", "UX", "Performance", "Datenschutz", "Migration", "Quick_Win"], rnd.randint(0, 2))
    a("<labels>%s</labels>" % "".join("<label>%s</label>" % l for l in labels))
    a("<created>%s</created>" % jdate(t["created"]))
    a("<updated>%s</updated>" % jdate(t["updated"]))
    if sk == "done":
        a("<resolved>%s</resolved>" % jdate(t["updated"]))
    for v in sorted(set(rnd.sample(VERSIONS, 1 if rnd.random() < 0.85 else 2))):
        a("<fixVersion>%s</fixVersion>" % v)
    for c in rnd.sample(COMPONENTS, rnd.randint(1, 2)):
        a("<component>%s</component>" % escape(c))
    if rnd.random() < 0.3:
        a("<due>%s</due>" % jdate(t["updated"] + timedelta(days=14)))
    a("<votes>0</votes><watches>%d</watches>" % rnd.randint(0, 5))
    if rnd.random() < 0.55:
        a("<comments>")
        for c in range(rnd.randint(1, 3)):
            a('<comment id="%d" author="JIRAUSER1%04d" created="%s">%s</comment>' % (t["id"] * 10 + c, rnd.randint(0, 9999), jdate(t["updated"]),
              escape("<p>%s</p>" % rnd.choice(["Getestet auf INT – ok.", "Bitte Rückmeldung vom Fachbereich.", "Umgesetzt, Review offen.", "Abnahme durch PO erfolgt."]))))
        a("</comments>")
    links = []
    if t["i"] > 5 and rnd.random() < 0.35:
        links.append(("Relates", "10003", "relates to", tickets[rnd.randint(0, t["i"] - 1)]))
    if t["type"][0] == "Bug" and t["i"] > 5 and rnd.random() < 0.4:
        links.append(("Blocks", "10000", "is blocked by", tickets[rnd.randint(0, t["i"] - 1)]))
    if t["type"][0] == "Story" and t["i"] > 5 and rnd.random() < 0.25:
        links.append(("Test", "10200", "is tested by", tickets[rnd.randint(0, t["i"] - 1)]))
    if links:
        a("<issuelinks>")
        for name, lid, desc, other in links:
            a('<issuelinktype id="%s"><name>%s</name><inwardlinks description="%s"><issuelink><issuekey id="%d">%s</issuekey></issuelink></inwardlinks></issuelinktype>'
              % (lid, name, desc, other["id"], other["key"]))
        a("</issuelinks>")
    if rnd.random() < 0.2:
        a('<attachments><attachment id="%d" name="screenshot-%d.png" size="%d" author="TP%d" created="%s"/></attachments>'
          % (t["id"] + 900000, t["i"], rnd.randint(20000, 400000), rnd.randint(1, 8), jdate(t["created"])))
    subs = [s for s in tickets if s.get("parent") is t]
    if subs:
        a("<subtasks>%s</subtasks>" % "".join('<subtask id="%d">%s</subtask>' % (s["id"], s["key"]) for s in subs))
    a("<customfields>")
    a('<customfield id="customfield_11301" key="com.atlassian.jira.plugin.system.customfieldtypes:textarea"><customfieldname>Affected Services/Domains</customfieldname>'
      '<customfieldvalues><customfieldvalue>%s</customfieldvalue></customfieldvalues></customfield>' % escape("<p>%s</p>" % t["dom"]))
    a('<customfield id="customfield_10601" key="com.atlassian.jira.plugin.system.customfieldtypes:select"><customfieldname>Domain</customfieldname>'
      '<customfieldvalues><customfieldvalue key="105%02d"><![CDATA[ %s ]]></customfieldvalue></customfieldvalues></customfield>' % (list(DOMAINS).index(t["dom"]), t["dom"]))
    if sk != "new":
        a('<customfield id="customfield_10700" key="com.atlassian.jira.plugin.system.customfieldtypes:labels"><customfieldname>INT Tag</customfieldname>'
          '<customfieldvalues><label>MFE-%d.0.0-%s</label></customfieldvalues></customfield>' % (50 + rnd.randint(0, 6), t["updated"].strftime("%d.%m.%Y")))
    po = rnd.choice(PEOPLE)
    a('<customfield id="customfield_11204" key="com.atlassian.jira.plugin.system.customfieldtypes:userpicker"><customfieldname>Responsible PO</customfieldname>'
      '<customfieldvalues><customfieldvalue displayname="%s">tp%d</customfieldvalue></customfieldvalues></customfield>' % (po, PEOPLE.index(po)))
    if t["type"][0] != "Epic":
        a('<customfield id="customfield_10206" key="com.pyxis.greenhopper.jira:gh-sprint"><customfieldname>Sprint</customfieldname>'
          '<customfieldvalues><customfieldvalue id="%d">%s</customfieldvalue></customfieldvalues></customfield>' % (500 + rnd.randint(0, 5), rnd.choice(SPRINTS)))
        if epics and rnd.random() < 0.7:
            e = rnd.choice(epics)
            a('<customfield id="customfield_10101" key="com.pyxis.greenhopper.jira:gh-epic-link"><customfieldname>Epic Link</customfieldname>'
              '<customfieldvalues><customfieldvalue>%s</customfieldvalue></customfieldvalues></customfield>' % e["key"])
    a("</customfields>")
    a("</item>")
    return "\n".join(o)

# Unteraufgaben zuerst ihrem Elternticket zuordnen, damit <subtasks> beim Elternticket stimmt
body_items = {}
for t in tickets:
    if t["type"][0] == "Sub-task":
        body_items[t["i"]] = item(t)
for t in tickets:
    if t["i"] not in body_items:
        body_items[t["i"]] = item(t)

head = ('<?xml version="1.0" encoding="UTF-8"?>\n'
        "<!-- Synthetischer Testexport (erfundene Inhalte, Platzhalter-Personen) im Format eines Jira-Server-10.x-XML-Exports.\n"
        "     Erzeugt mit webapp/tests/tools/gen_jira_test_export.py, %d Tickets. -->\n"
        '<rss version="0.92">\n<channel>\n<title>Jira ONESCM</title>\n<link>https://jira.example.com</link>\n'
        "<description>Synthetischer Testexport mit %d Vorgängen</description>\n<language>de-de</language>\n"
        '<issue start="0" end="%d" total="%d"/>\n' % (N, N, N, N))
with open(OUT, "w", encoding="utf-8") as f:
    f.write(head + "\n".join(body_items[i] for i in range(N)) + "\n</channel>\n</rss>\n")
from collections import Counter
print("%s: %d Tickets, %s" % (OUT, N, dict(Counter(t["type"][0] for t in tickets))))

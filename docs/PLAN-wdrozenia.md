# Plan wdrożenia: współbieżność, workflow, biblioteka, sugestie, roadmap

Źródło wymagań: `wymagania-wspolbieznosc-i-workflow.md`. Plan zaakceptowany 2026-10-04.
Szczegóły użytkowe: README → „Concurrency, workflow & change management”.

## Decyzje przyjęte

| # | Decyzja | Przyjęto |
|---|---|---|
| D1 | Widoczność pomysłów w Roadmapie | Globalnie dla wszystkich zalogowanych; organizacja (i nazwisko) zgłaszającego ukryte przed innymi organizacjami |
| D2 | Podpis elektroniczny (Part 11) | Ponowne uwierzytelnienie hasłem + zapis znaczenia, wersji i SHA-256 treści; polityki haseł itp. poza zakresem |
| D3 | ReqIF | Eksport ReqIF 1.2 macierzy aplikowalności (bez importu) |
| D4 | Istniejące dane | Statusy draft/review/approved zachowane (klucze stanów wariantu 2); każdy element dostał wersję 1 |
| D5 | Odświeżanie blokad | Polling (15–20 s) |
| D6 | Kolejność | F0 → F1 → F2 → F3 → F4 → F5 |

## Status

| Faza | Zakres | Status |
|---|---|---|
| F0.1 | Uprawnienia per rola, nadpisania per organizacja, admin organizacji | ✅ |
| F0.2 | Wersjonowanie elementów, ETag, diff wersji | ✅ |
| F0.3 | Audit log (append-only) | ✅ |
| F0.4 | Brak fizycznego usuwania (Obsolete; wyjątek: nietknięty nowy element / pusta sekcja) | ✅ |
| F0.5 | Powiadomienia w aplikacji + e-mail, obserwowanie | ✅ |
| F0.6 | Testy (pytest, schemat `rmt_test`) | ✅ 52 testy |
| F1 | Blokady jako lease, heartbeat, beacon, override, „powiadom gdy wolne”, If-Match/412 z diffem, blokada strukturalna | ✅ |
| F2 | Silnik workflow (org + nadpisanie w projekcie), szablony 1/2/3, change request + analiza wpływu, suspect, review jako obiekt, podpisy, baseline'y kamieni milowych | ✅ |
| F3 | Komentarze ↔ sugestie, workflow sugestii, Nieaktualna, integracja z workflow/review, eksport RID | ✅ |
| F4 | Biblioteka, wydania, macierz aplikowalności, aktualizacje, dashboard, Excel/ReqIF | ✅ |
| F4.6 | Wymagania parametryczne, reguły sugerowanej aplikowalności | ✅ |
| F5 | Roadmap: kanban, lista, zgłaszanie z podpowiedzią duplikatów, głosy, oficjalne odpowiedzi, panel zespołu, release notes | ✅ |

## Druga runda (2026-10-04)

| Zakres | Status |
|---|---|
| Awatary osób edytujących przy wymaganiu i dokumencie (na żywo) | ✅ |
| Strumień zdarzeń SSE zamiast pollingu (blokady, powiadomienia) | ✅ |
| Powiadomienie „wolne” także przy cichym wygaśnięciu blokady (sweeper co 30 s) | ✅ |
| Ustawienia organizacji w UI (czasy blokad, rozdział obowiązków) | ✅ |
| Macierz uprawnień ról w UI | ✅ |
| Wizualny edytor workflow (+ JSON jako tryb zaawansowany) | ✅ |
| Prefiks kluczy projektu / biblioteki | ✅ |
| Zapis schematu (typy, glosariusz, normy) tylko dla admina organizacji | ✅ |
| ReqIF: eksport i import dokumentu | ✅ |
| Testy frontendu (Vitest) | ✅ 13 testów; backend 59 |

## Poza zakresem / do rozważenia

- Współdzielona edycja w czasie rzeczywistym (Yjs) — zgodnie ze specyfikacją.
- Wspólny broker zdarzeń (LISTEN/NOTIFY) przy wielu workerach.
- ReqIF: aktualizacja wcześniej zaimportowanych elementów i import relacji.

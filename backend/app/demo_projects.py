"""Two realistic demo projects for trying the tool end to end.

    .venv/Scripts/python.exe -m app.demo_projects

Idempotent: a project that already exists (by name) is skipped. Everything
goes through the same services the API uses (versions, workflow
transitions, change requests, suggestions, audit), so the history looks
like a team actually worked on it. Emails are not sent while seeding.

1. EO-1 Earth Observation Smallsat  — space, change-managed workflow,
   mission → system → verification, PDR review with RIDs, a change request
   that leaves suspect links, and the GEN-SAT generic library imported.
2. SmartInfuse IP-200 Infusion Pump — medical device, *regulated*
   workflow (e-signatures, author ≠ approver), user needs → system
   requirements → risk controls → V&V.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

from app import models  # noqa: F401
from app.database import SessionLocal
from app.models.comment import ItemComment
from app.models.document import Document
from app.models.item import Item
from app.models.item_type import ItemType, ItemTypeAttribute
from app.models.library import LibraryRelease, ProjectLibrary
from app.models.link import Link, LinkType
from app.models.organization import Organization
from app.models.parameter import Parameter
from app.models.project import Project
from app.models.project_access import ProjectAccess
from app.models.user import User
from app.models.workflow import DocumentWorkflowRole
from app.models.workflow_def import Review, ReviewItem, ReviewParticipant
from app.services import email as mail
from app.services import library as lib
from app.services import suggestions as sug
from app.services import workflow_engine as wf
from app.services.bootstrap import ensure_default_workflow
from app.services.keys import next_key
from app.services.notifications import watch
from app.services.versioning import bump_structure, record_version
from app.services.workflow_templates import ITEM_TEMPLATES

PASSWORD = "demo"  # dev-mode auth accepts any password for e-signatures

PEOPLE = {
    "katarzyna": ("katarzyna.lewandowska", "Katarzyna Lewandowska"),
    "jan": ("jan.kowalski", "Jan Kowalski"),
    "piotr": ("piotr.zielinski", "Piotr Zieliński"),
    "maria": ("maria.wisniewska", "Maria Wiśniewska"),
    "tomasz": ("tomasz.wojcik", "Tomasz Wójcik"),
}


# --------------------------------------------------------------------------
# Data model for the content below


@dataclass
class R:
    """A requirement. `state`: D draft, R in review, A approved,
    I implemented, V verified."""

    ref: str
    title: str
    text: str
    priority: str = "medium"
    method: str = "test"
    state: str = "A"
    author: str = "piotr"
    owner: str = "jan"
    rationale: str | None = None
    derives: list[str] = field(default_factory=list)


@dataclass
class V:
    ref: str
    title: str
    text: str
    method: str
    verifies: list[str]
    result: str = "pending"
    executed: date | None = None
    state: str = "A"


# ==========================================================================
# 1. EO-1 Earth Observation Smallsat
# ==========================================================================

EO1_PARAMS = [
    ("orbit_altitude", "Orbit altitude", 550, "km", "Sun-synchronous, LTAN 10:30"),
    ("eclipse_duration", "Max eclipse duration", 35, "min", "Worst case for 550 km SSO"),
    ("mission_life", "Design lifetime", 5, "years", None),
    ("gsd", "Ground sample distance (pan)", 3, "m", "At nadir"),
    ("swath_width", "Swath width", 30, "km", None),
    ("downlink_rate", "X-band downlink rate", 150, "Mbit/s", None),
    ("mass_limit", "Launch mass allocation", 85, "kg", "Rideshare slot"),
    ("power_eol", "End-of-life orbit-average power", 180, "W", None),
    ("pointing_accuracy", "Pointing accuracy (3σ)", 0.05, "deg", None),
]

EO1_MISSION = [
    ("Mission objectives", [
        R("MR-OBJ1", "Systematic land monitoring",
          "The mission shall acquire multispectral imagery of all land masses between 60°S and 70°N at least once every 10 days.",
          "high", "analysis", rationale="Driven by the agricultural monitoring service contract."),
        R("MR-OBJ2", "Rapid tasking",
          "The mission shall image any customer-requested point target within 48 hours of the request being accepted.",
          "high", "demonstration"),
        R("MR-OBJ3", "Archive continuity",
          "The mission shall deliver products radiometrically consistent with the predecessor EO-0 archive within 5 %.",
          "medium", "analysis"),
    ]),
    ("Orbit and lifetime", [
        R("MR-ORB1", "Operational orbit",
          "The spacecraft shall operate in a sun-synchronous orbit at {{param:orbit_altitude}} altitude with a 10:30 descending node.",
          "high", "analysis"),
        R("MR-ORB2", "Design lifetime",
          "The spacecraft shall be designed for {{param:mission_life}} of operations in orbit.",
          "high", "analysis"),
        R("MR-ORB3", "End-of-life disposal",
          "The spacecraft shall re-enter or be moved to a disposal orbit within 5 years after end of mission, in line with ISO 24113.",
          "high", "analysis", rationale="Space debris mitigation is a launch licence condition."),
    ]),
    ("Imaging performance", [
        R("MR-IMG1", "Spatial resolution",
          "The imager shall provide a ground sample distance of {{param:gsd}} or better in the panchromatic band at nadir.",
          "high", "test"),
        R("MR-IMG2", "Swath",
          "The imager shall provide a swath of at least {{param:swath_width}} at nadir.",
          "high", "analysis"),
        R("MR-IMG3", "Spectral bands",
          "The imager shall provide one panchromatic and four multispectral bands (blue, green, red, near-infrared).",
          "medium", "test"),
        R("MR-IMG4", "Geolocation accuracy",
          "Level-1C products shall have a geolocation accuracy better than 10 m CE90 without ground control points.",
          "medium", "analysis"),
    ]),
    ("Data delivery", [
        R("MR-DAT1", "Daily data volume",
          "The system shall downlink at least 200 Gbit of payload data per day.",
          "high", "analysis"),
        R("MR-DAT2", "Product latency",
          "Standard products shall be available to customers within 6 hours of acquisition.",
          "medium", "demonstration"),
    ]),
    ("Operations", [
        R("MR-OPS1", "Autonomy",
          "The spacecraft shall operate autonomously for at least 72 hours without ground contact.",
          "high", "test"),
        R("MR-OPS2", "Ground segment",
          "The mission shall be operated from a single control centre with at least two polar ground stations.",
          "medium", "inspection"),
    ]),
]

EO1_SRS = [
    ("General", [
        R("SY-GEN1", "Launch mass",
          "The total spacecraft wet mass shall not exceed {{param:mass_limit}} including 10 % system margin.",
          "high", "test", derives=["MR-ORB1"]),
        R("SY-GEN2", "Launch envelope",
          "The stowed spacecraft shall fit within the 60 × 70 × 80 cm rideshare envelope.",
          "high", "inspection"),
        R("SY-GEN3", "Reliability",
          "The probability of mission success at end of design life shall be at least 0.85.",
          "medium", "analysis", derives=["MR-ORB2"]),
    ]),
    ("Electrical Power (EPS)", [
        R("SY-EPS1", "Orbit-average power",
          "The EPS shall provide {{param:power_eol}} orbit-average power at end of life in the worst-case attitude profile.",
          "high", "analysis", derives=["MR-ORB2"]),
        R("SY-EPS2", "Eclipse autonomy",
          "The battery shall supply all platform and payload loads for {{param:eclipse_duration}} of eclipse with a depth of discharge below 30 %.",
          "high", "test", derives=["MR-ORB1"]),
        R("SY-EPS3", "Bus voltage",
          "The EPS shall provide a regulated 28 V ± 1 V main bus and 5 V / 3.3 V secondary rails.",
          "medium", "test"),
        R("SY-EPS4", "Latch-up protection",
          "Each power output shall have an independently resettable current limiter that trips within 10 ms.",
          "high", "test", state="I"),
        R("SY-EPS5", "Battery cell balancing",
          "The battery management system shall keep cell voltages within 20 mV of each other during charge.",
          "low", "test", state="R"),
    ]),
    ("Attitude and Orbit Control (AOCS)", [
        R("SY-AOC1", "Pointing accuracy",
          "The AOCS shall point the imager boresight with an accuracy of {{param:pointing_accuracy}} (3σ) during imaging.",
          "high", "test", derives=["MR-IMG4"]),
        R("SY-AOC2", "Pointing stability",
          "Attitude jitter shall be below 10 µrad over any 50 ms imaging window.",
          "high", "analysis", derives=["MR-IMG1"]),
        R("SY-AOC3", "Agility",
          "The spacecraft shall slew 30° about any axis and settle within 45 s.",
          "medium", "test", derives=["MR-OBJ2"]),
        R("SY-AOC4", "Safe mode",
          "In safe mode the AOCS shall point the solar arrays to within 15° of the Sun using only coarse sensors.",
          "high", "test"),
        R("SY-AOC5", "Detumbling",
          "After separation the AOCS shall reduce body rates from 10 °/s to below 0.5 °/s within 3 orbits.",
          "high", "analysis", state="R"),
    ]),
    ("On-Board Computer and Software (OBC)", [
        R("SY-OBC1", "Autonomous operations",
          "The flight software shall execute time-tagged command schedules covering at least 72 hours.",
          "high", "test", derives=["MR-OPS1"]),
        R("SY-OBC2", "Fault detection, isolation and recovery",
          "The flight software shall detect the failure of any single unit and switch to its redundant counterpart within 60 s.",
          "high", "test", derives=["MR-OPS1"]),
        R("SY-OBC3", "Mass memory",
          "The payload mass memory shall store at least 1 Tbit of image data with end-of-life bit error rate below 1e-12.",
          "high", "test", derives=["MR-DAT1"]),
        R("SY-OBC4", "Software update",
          "It shall be possible to upload and activate new flight software images in orbit without loss of the spacecraft.",
          "medium", "demonstration", state="D", author="anna"),
        R("SY-OBC5", "Time synchronisation",
          "On-board time shall be synchronised to GPS time with an accuracy better than 1 µs.",
          "medium", "test"),
    ]),
    ("Communications (TT&C and payload data)", [
        R("SY-COM1", "S-band TT&C",
          "The spacecraft shall support S-band telecommand at 64 kbit/s and telemetry at 256 kbit/s, CCSDS compliant.",
          "high", "test"),
        R("SY-COM2", "X-band downlink",
          "The payload data transmitter shall downlink at {{param:downlink_rate}} with BER below 1e-7.",
          "high", "test", derives=["MR-DAT1"]),
        R("SY-COM3", "Data encryption",
          "Payload data shall be encrypted with AES-256 before downlink.",
          "high", "test", state="R"),
        R("SY-COM4", "Telecommand authentication",
          "All telecommands shall be authenticated; unauthenticated commands shall be rejected and counted.",
          "high", "test"),
    ]),
    ("Payload (Imager)", [
        R("SY-PAY1", "Panchromatic resolution",
          "The imager shall achieve {{param:gsd}} ground sample distance at {{param:orbit_altitude}} with MTF above 0.10 at Nyquist.",
          "high", "test", derives=["MR-IMG1"]),
        R("SY-PAY2", "Swath",
          "The focal plane shall cover a swath of {{param:swath_width}} at nadir.",
          "high", "analysis", derives=["MR-IMG2"]),
        R("SY-PAY3", "Spectral bands",
          "The imager shall provide PAN 450–800 nm and MS bands B 450–520, G 520–600, R 630–690, NIR 760–890 nm.",
          "high", "test", derives=["MR-IMG3"]),
        R("SY-PAY4", "Signal-to-noise ratio",
          "SNR shall exceed 100 for a 30 % albedo target at 30° solar elevation in all bands.",
          "high", "test", derives=["MR-OBJ3"], state="R"),
        R("SY-PAY5", "On-board calibration",
          "The imager shall include a sun-diffuser calibration mechanism usable once per month.",
          "medium", "test", state="D", author="anna"),
    ]),
    ("Thermal", [
        R("SY-THM1", "Detector temperature",
          "The focal plane shall be kept at 20 °C ± 2 °C during imaging.",
          "high", "test", derives=["MR-OBJ3"]),
        R("SY-THM2", "Battery temperature",
          "Battery temperature shall stay within 5 °C to 30 °C in all modes.",
          "high", "analysis"),
        R("SY-THM3", "Heater control",
          "Survival heaters shall be thermostatically controlled and independent of the OBC.",
          "medium", "inspection"),
    ]),
    ("Structure and Mechanisms", [
        R("SY-STR1", "Stiffness",
          "The first lateral eigenfrequency in launch configuration shall exceed 60 Hz.",
          "high", "test"),
        R("SY-STR2", "Quasi-static loads",
          "The structure shall withstand 12 g axial and 8 g lateral quasi-static loads with a safety factor of 1.25.",
          "high", "test"),
        R("SY-STR3", "Solar array deployment",
          "The solar arrays shall deploy by a single command with redundant release actuators.",
          "high", "test", state="R"),
    ]),
    ("Propulsion", [
        R("SY-PRO1", "Delta-v",
          "The propulsion system shall provide at least 80 m/s of delta-v for orbit maintenance and disposal.",
          "high", "analysis", derives=["MR-ORB3"]),
        R("SY-PRO2", "Propellant",
          "The propulsion system shall use a non-toxic propellant compatible with rideshare safety rules.",
          "medium", "inspection", state="D", author="anna"),
    ]),
    ("Environment", [
        R("SY-ENV1", "Radiation tolerance",
          "All electronics shall tolerate a total ionising dose of 20 krad(Si) behind 2 mm aluminium.",
          "high", "analysis"),
        R("SY-ENV2", "Single-event effects",
          "No single-event effect shall cause a permanent loss of function; SEL-sensitive parts shall be protected.",
          "high", "analysis", state="R"),
    ]),
]

EO1_VER = [
    ("Platform tests", [
        V("VA-EPS2", "Battery eclipse discharge test",
          "Discharge the flight battery with the worst-case load profile for one eclipse at 5 °C and measure depth of discharge.",
          "Thermal-vacuum chamber, flight battery, load simulator", ["SY-EPS2"], "pass", date(2026, 8, 12)),
        V("VA-EPS4", "Current limiter trip test",
          "Short each output through a 0.1 Ω load and record trip time and automatic recovery.",
          "PCDU bench test", ["SY-EPS4"], "pass", date(2026, 7, 2)),
        V("VA-AOC1", "Pointing accuracy end-to-end test",
          "Hardware-in-the-loop simulation with star tracker stimulator over 100 imaging scenarios.",
          "HIL facility", ["SY-AOC1"], "pending"),
        V("VA-AOC4", "Safe-mode Sun acquisition test",
          "Air-bearing table test starting from random attitudes with only coarse Sun sensors enabled.",
          "Air-bearing table", ["SY-AOC4"], "pass", date(2026, 6, 20)),
        V("VA-OBC2", "FDIR switch-over test",
          "Inject failures of each unit on the FlatSat and measure switch-over time.",
          "FlatSat", ["SY-OBC2"], "fail", date(2026, 9, 3)),
        V("VA-OBC3", "Mass memory BER test",
          "Write/read 2 Tbit of pseudo-random data and count bit errors.",
          "FlatSat", ["SY-OBC3"], "pass", date(2026, 8, 30)),
        V("VA-COM1", "S-band RF compatibility test",
          "End-to-end compatibility test with the ground station network.",
          "RF compatibility test", ["SY-COM1", "SY-COM4"], "pending"),
        V("VA-COM2", "X-band BER test",
          "Measure BER at the specified rate with the representative link margin.",
          "RF bench", ["SY-COM2"], "pass", date(2026, 9, 10)),
    ]),
    ("Payload tests", [
        V("VA-PAY1", "MTF measurement",
          "Measure modulation transfer function with a slanted-edge target in the optical ground support equipment.",
          "Optical bench", ["SY-PAY1"], "pending"),
        V("VA-PAY3", "Spectral response measurement",
          "Measure the relative spectral response of every band with a monochromator.",
          "Optical bench", ["SY-PAY3"], "pass", date(2026, 7, 28)),
        V("VA-THM1", "Focal plane thermal balance test",
          "Thermal balance test in hot and cold imaging cases.",
          "TVAC", ["SY-THM1"], "pending"),
    ]),
    ("Environmental tests", [
        V("VA-STR1", "Sine survey",
          "Low-level sine survey on the shaker in all three axes.",
          "Shaker", ["SY-STR1"], "pass", date(2026, 9, 18)),
        V("VA-STR2", "Static load test",
          "Static load test on the structural model to qualification levels.",
          "Static test rig", ["SY-STR2"], "pass", date(2026, 5, 15)),
        V("VA-ENV1", "Radiation analysis",
          "Dose-depth analysis with SPENVIS for the 5-year mission.",
          "Analysis", ["SY-ENV1"], "pass", date(2026, 4, 2)),
    ]),
]

EO1_COMMENTS = [
    ("SY-AOC1", "maria", "Is 0.05° compatible with the 10 m geolocation target without GCPs? Please attach the error budget.",
     [("jan", "Budget is in TN-AOC-012, it closes with 15 % margin.")], True),
    ("SY-OBC2", "tomasz", "VA-OBC2 failed on the redundant OBC switch-over — 84 s measured. Do we relax the requirement or fix the watchdog?",
     [("piotr", "Watchdog timeout is 60 s by itself — we need to change the design, not the requirement.")], False),
    ("SY-COM3", "maria", "Please state where the keys are stored and how they are rotated — needed for the security review.", [], False),
    ("SY-PAY4", "jan", "@piotr.zielinski SNR at 30° solar elevation is very tight for NIR. Can you check with the detector vendor?", [], False),
    ("SY-EPS2", "anna", "Test passed at 27 % DoD. Nice.", [], True),
]


# ==========================================================================
# 2. SmartInfuse IP-200 infusion pump
# ==========================================================================

IP_PARAMS = [
    ("flow_min", "Minimum flow rate", 0.1, "mL/h", None),
    ("flow_max", "Maximum flow rate", 1200, "mL/h", None),
    ("flow_accuracy", "Flow accuracy", 5, "%", "Over the full flow range, per IEC 60601-2-24"),
    ("occlusion_max", "Max occlusion alarm threshold", 900, "mmHg", None),
    ("air_bubble", "Smallest detected air bubble", 50, "µL", None),
    ("battery_runtime", "Battery runtime", 8, "h", "At 25 mL/h"),
    ("alarm_volume", "High-priority alarm volume", 65, "dB(A)", "At 1 m"),
    ("bolus_max", "Maximum bolus volume", 50, "mL", None),
]

IP_NEEDS = [
    ("Clinical user needs", [
        R("UN-1", "Accurate delivery",
          "Clinicians need the pump to deliver the prescribed volume of medication accurately over the prescribed time.",
          "high", "demonstration", author="piotr"),
        R("UN-2", "Safe use by busy nurses",
          "Nurses need to program a typical infusion in under 60 seconds without errors, including at night with low light.",
          "high", "demonstration", author="anna"),
        R("UN-3", "Protection from dosing errors",
          "Clinicians need the pump to prevent programming of doses outside safe limits for the selected drug.",
          "high", "demonstration", author="piotr"),
        R("UN-4", "Awareness of problems",
          "Clinicians need to be alerted immediately to any condition that stops or compromises the infusion.",
          "high", "demonstration", author="anna"),
        R("UN-5", "Mobility",
          "Patients need to keep receiving therapy while being transported within the hospital.",
          "medium", "demonstration", author="piotr"),
        R("UN-6", "Integration with the hospital",
          "The pharmacy needs to update drug libraries on all pumps and retrieve infusion logs centrally.",
          "medium", "demonstration", author="anna", state="R"),
    ]),
]

IP_SRS = [
    ("Delivery", [
        R("PS-DEL1", "Flow range",
          "The pump shall deliver continuous infusions from {{param:flow_min}} to {{param:flow_max}} in 0.1 mL/h steps.",
          "high", "test", derives=["UN-1"]),
        R("PS-DEL2", "Flow accuracy",
          "Delivered volume shall be within ±{{param:flow_accuracy}} of the programmed volume under the conditions of IEC 60601-2-24.",
          "high", "test", derives=["UN-1"]),
        R("PS-DEL3", "Bolus",
          "The pump shall deliver a clinician bolus of up to {{param:bolus_max}} at a programmable rate.",
          "high", "test", derives=["UN-1"]),
        R("PS-DEL4", "KVO rate",
          "At the end of an infusion the pump shall switch to a keep-vein-open rate of 1 mL/h or the programmed rate, whichever is lower.",
          "medium", "test", derives=["UN-1"]),
        R("PS-DEL5", "Secondary infusion",
          "The pump shall support a piggyback secondary infusion and resume the primary automatically when it completes.",
          "medium", "test", state="R", derives=["UN-1"]),
    ]),
    ("Alarms", [
        R("PS-ALM1", "Alarm priorities",
          "Alarms shall follow IEC 60601-1-8 high, medium and low priority signals, both audible and visual.",
          "high", "test", derives=["UN-4"]),
        R("PS-ALM2", "Alarm volume",
          "High-priority alarms shall reach at least {{param:alarm_volume}}; the volume shall not be adjustable below 45 dB(A).",
          "high", "test", derives=["UN-4"]),
        R("PS-ALM3", "Alarm latency",
          "Any high-priority alarm condition shall be annunciated within 1 s of detection.",
          "high", "test", derives=["UN-4"]),
        R("PS-ALM4", "Alarm silence",
          "A silenced alarm shall re-annunciate after 2 minutes if the condition persists.",
          "medium", "test", derives=["UN-4"]),
    ]),
    ("Occlusion and air detection", [
        R("PS-OCC1", "Downstream occlusion",
          "The pump shall detect a downstream occlusion and stop delivery before line pressure exceeds {{param:occlusion_max}}.",
          "high", "test", derives=["UN-4"]),
        R("PS-OCC2", "Bolus after occlusion",
          "The unintended bolus released after an occlusion is cleared shall not exceed 0.5 mL.",
          "high", "test", derives=["UN-1"]),
        R("PS-AIR1", "Air-in-line detection",
          "The pump shall detect single air bubbles of {{param:air_bubble}} or larger and stop delivery.",
          "high", "test", derives=["UN-4"]),
        R("PS-AIR2", "Cumulative air",
          "The pump shall alarm when cumulative air exceeds 1 mL within any 15 minute window.",
          "high", "test", state="R", derives=["UN-4"]),
    ]),
    ("Dose error reduction", [
        R("PS-DER1", "Drug library",
          "The pump shall hold a drug library of at least 5000 entries with soft and hard limits per care area.",
          "high", "test", derives=["UN-3"]),
        R("PS-DER2", "Hard limits",
          "The pump shall not start an infusion whose dose rate exceeds a hard limit for the selected drug.",
          "high", "test", derives=["UN-3"]),
        R("PS-DER3", "Soft limit override",
          "Exceeding a soft limit shall require explicit confirmation and shall be logged with the user ID.",
          "high", "test", derives=["UN-3"]),
        R("PS-DER4", "Units",
          "Dose units shall be selected from the drug library entry and shall not be free-text.",
          "medium", "inspection", derives=["UN-3"], state="D"),
    ]),
    ("Power and battery", [
        R("PS-PWR1", "Battery runtime",
          "A new battery shall power the pump for at least {{param:battery_runtime}} at 25 mL/h.",
          "high", "test", derives=["UN-5"]),
        R("PS-PWR2", "Low battery alarm",
          "The pump shall give a medium-priority alarm 30 minutes before battery depletion and a high-priority alarm 5 minutes before.",
          "high", "test", derives=["UN-4", "UN-5"]),
        R("PS-PWR3", "Mains failure",
          "Loss of mains power shall not interrupt delivery.",
          "high", "test", derives=["UN-5"]),
    ]),
    ("User interface and usability", [
        R("PS-UI1", "Programming steps",
          "A standard continuous infusion shall be programmable in no more than 6 steps from the home screen.",
          "high", "demonstration", derives=["UN-2"]),
        R("PS-UI2", "Display legibility",
          "Rate and volume shall be legible from 3 m at 100 lx and at night-mode brightness.",
          "medium", "test", derives=["UN-2"]),
        R("PS-UI3", "Summative usability",
          "Summative usability validation per IEC 62366-1 shall show no use errors leading to serious harm.",
          "high", "demonstration", derives=["UN-2"], state="R"),
    ]),
    ("Software", [
        R("PS-SW1", "Software safety class",
          "The pump control software shall be developed as IEC 62304 software safety class C.",
          "high", "inspection"),
        R("PS-SW2", "Independent safety monitor",
          "An independent safety processor shall monitor motor revolutions and stop the motor on any discrepancy with the commanded rate above 10 %.",
          "high", "test", derives=["UN-1"]),
        R("PS-SW3", "Event log",
          "The pump shall log at least 5000 events (programming, alarms, overrides) with timestamps, retained without power.",
          "medium", "test", derives=["UN-6"]),
    ]),
    ("Connectivity and cybersecurity", [
        R("PS-NET1", "Wireless drug library update",
          "Drug libraries shall be updatable over Wi-Fi from the pharmacy server; the pump shall verify the library signature before use.",
          "medium", "test", derives=["UN-6"], state="R"),
        R("PS-NET2", "Secure communication",
          "All network communication shall use TLS 1.3 with mutual certificate authentication.",
          "high", "test", derives=["UN-6"], state="D"),
        R("PS-NET3", "Therapy independence",
          "Loss of network connectivity shall not affect therapy delivery.",
          "high", "test", derives=["UN-6"]),
    ]),
    ("Electrical safety, EMC and environment", [
        R("PS-ELS1", "Basic safety",
          "The pump shall comply with IEC 60601-1 for a Class II, type CF defibrillation-proof applied part.",
          "high", "inspection"),
        R("PS-EMC1", "EMC",
          "The pump shall comply with IEC 60601-1-2 for the professional healthcare environment.",
          "high", "test"),
        R("PS-ENV1", "Ingress protection",
          "The pump shall be rated IPX4.",
          "medium", "test"),
        R("PS-ENV2", "Cleaning agents",
          "Enclosure materials shall withstand 500 wipe cycles with the listed hospital disinfectants without degradation.",
          "medium", "test", state="D"),
    ]),
]

IP_RISK = [
    ("Over-infusion", [
        R("RC-1", "Free-flow prevention",
          "The administration set shall include an anti-free-flow clamp that closes automatically when the door opens.",
          "high", "test", derives=["PS-DEL2"], rationale="Hazard H-01: free flow when the set is removed."),
        R("RC-2", "Motor runaway protection",
          "The safety monitor shall cut motor power within 1 s of detecting over-delivery.",
          "high", "test", derives=["PS-SW2"], rationale="Hazard H-02: software fault drives motor faster than commanded."),
    ]),
    ("Under-infusion", [
        R("RC-3", "Occlusion detection",
          "Downstream occlusion shall be detected within 30 minutes at 1 mL/h.",
          "high", "test", derives=["PS-OCC1"], rationale="Hazard H-05: unnoticed interruption of critical therapy."),
        R("RC-4", "Upstream occlusion",
          "The pump shall detect an empty container or closed upstream clamp and alarm.",
          "high", "test", derives=["PS-OCC1"], state="R"),
    ]),
    ("Air embolism", [
        R("RC-5", "Air detector self-test",
          "The air detector shall be self-tested at every start of infusion and every 30 minutes.",
          "high", "test", derives=["PS-AIR1"]),
    ]),
    ("Use error", [
        R("RC-6", "Decimal point protection",
          "Entered values with a leading decimal point shall be displayed with a leading zero and confirmed before start.",
          "high", "demonstration", derives=["PS-UI1"], rationale="Hazard H-11: tenfold dosing error."),
        R("RC-7", "Programming confirmation",
          "The pump shall show a summary of drug, concentration, rate and VTBI that must be confirmed before starting.",
          "high", "demonstration", derives=["PS-UI1", "PS-DER2"]),
    ]),
]

IP_VER = [
    ("Bench verification", [
        V("VV-DEL2", "Flow accuracy test (IEC 60601-2-24)",
          "Gravimetric measurement at 1, 25 and 1200 mL/h over 2 h with three sets.", "Gravimetric rig",
          ["PS-DEL2"], "pass", date(2026, 7, 14)),
        V("VV-OCC1", "Occlusion pressure and time-to-alarm",
          "Occlude downstream at 1 and 25 mL/h, record pressure and time to alarm, then bolus on release.",
          "Pressure rig", ["PS-OCC1", "PS-OCC2", "RC-3"], "pass", date(2026, 7, 21)),
        V("VV-AIR1", "Air bubble detection test",
          "Inject calibrated bubbles from 10 to 200 µL at minimum and maximum rate.",
          "Air detection rig", ["PS-AIR1", "RC-5"], "pass", date(2026, 8, 4)),
        V("VV-ALM", "Alarm characteristics test (IEC 60601-1-8)",
          "Measure sound pressure, pulse patterns and latency of every alarm.",
          "Anechoic room", ["PS-ALM1", "PS-ALM2", "PS-ALM3"], "pass", date(2026, 8, 18)),
        V("VV-PWR1", "Battery runtime test",
          "Run at 25 mL/h from full charge at 20 °C until shutdown.",
          "Bench", ["PS-PWR1", "PS-PWR2"], "pending"),
        V("VV-SW2", "Safety monitor fault injection",
          "Inject motor speed errors via debug interface and verify shutdown time.",
          "Software integration bench", ["PS-SW2", "RC-2"], "pass", date(2026, 9, 1)),
    ]),
    ("Validation", [
        V("VV-UI1", "Formative usability study",
          "15 nurses programming 10 scenarios; count steps, time and use errors.",
          "Usability lab", ["PS-UI1", "RC-6", "RC-7"], "pass", date(2026, 6, 9)),
        V("VV-UI3", "Summative usability validation",
          "Simulated-use validation with 30 representative users per IEC 62366-1.",
          "Simulated ward", ["PS-UI3"], "pending"),
    ]),
]

IP_COMMENTS = [
    ("PS-DER4", "maria", "Should we also block mixing mg and µg in the same care area? Seen that in the field.", [], False),
    ("PS-NET2", "tomasz", "Hospital IT may still run TLS 1.2 proxies — do we need a fallback?",
     [("anna", "No fallback for therapy-relevant data; maybe for log upload only.")], False),
    ("PS-DEL2", "maria", "Gravimetric results attached to VV-DEL2 — 3.1 % worst case.", [], True),
]


# ==========================================================================
# Seeding machinery


class Seeder:
    def __init__(self, db, org: Organization):
        self.db = db
        self.org = org
        self.users: dict[str, User] = {}
        self.items: dict[str, Item] = {}
        self.types = {t.key: t for t in db.query(ItemType).filter_by(org_id=org.id).all()}
        self.link_types = {lt.key: lt for lt in db.query(LinkType).filter_by(org_id=org.id).all()}

    # -- people
    def people(self) -> None:
        for short, (username, name) in PEOPLE.items():
            u = self.db.query(User).filter_by(username=username).first()
            if u is None:
                u = User(org_id=self.org.id, username=username, display_name=name, email=f"{username}@example.com")
                self.db.add(u)
                self.db.flush()
            self.users[short] = u
        anna = self.db.query(User).filter_by(username="anna").first()
        if anna:
            self.users["anna"] = anna
        else:
            self.users["anna"] = self.users["piotr"]
        self.users["admin"] = self.db.query(User).filter_by(username="admin").one()

    def grant(self, project: Project, roles: dict[str, str]) -> None:
        for short, role in roles.items():
            self.db.add(ProjectAccess(project_id=project.id, subject_type="user",
                                      subject_id=self.users[short].id, role=role))
        self.db.flush()

    # -- structure
    def project(self, name: str, prefix: str, visibility: str = "private") -> Project:
        p = Project(org_id=self.org.id, name=name, visibility=visibility, key_prefix=prefix)
        self.db.add(p)
        self.db.flush()
        self.db.add(ProjectAccess(project_id=p.id, subject_type="user",
                                  subject_id=self.users["admin"].id, role="admin"))
        return p

    def document(self, project: Project, name: str, order: int, approvers=("jan",), reviewers=("maria",)) -> Document:
        d = Document(project_id=project.id, name=name, order=order)
        self.db.add(d)
        self.db.flush()
        for a in approvers:
            self.db.add(DocumentWorkflowRole(document_id=d.id, user_id=self.users[a].id, role="approver"))
        for r in reviewers:
            self.db.add(DocumentWorkflowRole(document_id=d.id, user_id=self.users[r].id, role="reviewer"))
        return d

    def parameters(self, project: Project, params) -> None:
        for key, name, value, unit, desc in params:
            self.db.add(Parameter(project_id=project.id, key=key, name=name, value=value, unit=unit,
                                  data_type="constant", source="estimated", description=desc,
                                  updated_by="jan.kowalski"))

    def _item(self, project, document, type_key, title, text, parent, order, author, attributes) -> Item:
        from app.api.v1.items import _next_key

        item_type = self.types[type_key]
        attrs = dict(attributes)
        definition = wf.resolve_item_definition(self.db, project.id, item_type.id)
        if definition is not None:
            attrs[wf.STATUS_KEY] = wf.initial_state({"states": definition.states})
        item = Item(
            document_id=document.id, parent_id=parent.id if parent else None, item_type_id=item_type.id,
            title=title, description_md=text, attributes=attrs, order=order,
            key=_next_key(self.db, project.id, item_type) if item_type.behavior == "content" else None,
            updated_by=self.users[author].username,
        )
        self.db.add(item)
        record_version(self.db, item, changed_by=self.users[author], reason="create", initial=True)
        if item_type.behavior == "content":
            watch(self.db, self.users[author], "item", item.id)
        return item

    def requirements(self, project, document, sections, type_key="requirement") -> None:
        for s_order, (section_title, reqs) in enumerate(sections, start=1):
            section = self._item(project, document, "section", section_title, None, None, s_order, "jan", {})
            for order, r in enumerate(reqs, start=1):
                attrs = {"priority": r.priority, "verification_method": r.method,
                         "owner": self.users[r.owner].username}
                if r.rationale:
                    attrs["justification"] = r.rationale
                attrs = {k: v for k, v in attrs.items() if k in {a.key for a in self.types[type_key].attributes}}
                item = self._item(project, document, type_key, r.title, r.text, section, order, r.author, attrs)
                self.items[r.ref] = item
                item._demo = r  # type: ignore[attr-defined]
        bump_structure(self.db, document.id)
        self.db.flush()

    def verifications(self, project, document, sections) -> None:
        for s_order, (section_title, vas) in enumerate(sections, start=1):
            section = self._item(project, document, "section", section_title, None, None, s_order, "tomasz", {})
            for order, v in enumerate(vas, start=1):
                attrs = {"test_method": v.method, "result": v.result}
                if v.executed:
                    attrs["executed_date"] = v.executed.isoformat()
                item = self._item(project, document, "verification_activity", v.title, v.text, section, order,
                                  "tomasz", attrs)
                self.items[v.ref] = item
                item._demo = v  # type: ignore[attr-defined]
                for target in v.verifies:
                    self.link("verifies", item, self.items[target])
        self.db.flush()

    def link(self, type_key: str, source: Item, target: Item) -> None:
        self.db.add(Link(source_item_id=source.id, target_item_id=target.id,
                         link_type_id=self.link_types[type_key].id))

    def derive_links(self) -> None:
        for item in list(self.items.values()):
            demo = getattr(item, "_demo", None)
            if isinstance(demo, R):
                for parent_ref in demo.derives:
                    self.link("derives_from", item, self.items[parent_ref])
        self.db.flush()

    # -- workflow
    def run(self, item: Item, key: str, user: str, comment: str | None = None, **payload) -> None:
        wf.execute(self.db, wf.ItemSubject(self.db, item), key, self.users[user], comment=comment,
                   payload={"password": PASSWORD, **payload})

    def advance(self, approver="jan", implementer="piotr", verifier="tomasz") -> None:
        path = {"D": [], "R": ["submit"], "A": ["submit", "approve"],
                "I": ["submit", "approve", "implement"], "V": ["submit", "approve", "implement", "verify"]}
        for item in self.items.values():
            demo = getattr(item, "_demo", None)
            steps = path[demo.state]
            for step in steps:
                actor = {"submit": demo.author if isinstance(demo, R) else "tomasz", "approve": approver,
                         "implement": implementer, "verify": verifier}[step]
                self.run(item, step, actor)
        self.db.flush()

    def comments(self, threads) -> None:
        for ref, author, body, replies, resolved in threads:
            item = self.items[ref]
            c = ItemComment(item_id=item.id, author_id=self.users[author].id, body=body)
            self.db.add(c)
            self.db.flush()
            for r_author, r_body in replies:
                self.db.add(ItemComment(item_id=item.id, parent_comment_id=c.id,
                                        author_id=self.users[r_author].id, body=r_body))
            if resolved:
                c.resolved = True
                c.resolved_by_id = self.users[author].id
                c.resolved_at = datetime.now(timezone.utc)
            watch(self.db, self.users[author], "item", item.id)
        self.db.flush()


# --------------------------------------------------------------------------


def seed_eo1(s: Seeder) -> Project:
    db = s.db
    p = s.project("EO-1 Earth Observation Smallsat", "EO1")
    s.grant(p, {"katarzyna": "admin", "jan": "editor", "piotr": "editor", "anna": "editor",
                "tomasz": "editor", "maria": "reviewer"})
    s.parameters(p, EO1_PARAMS)
    mrd = s.document(p, "Mission Requirements", 0)
    srs = s.document(p, "System Requirements Specification", 1)
    ver = s.document(p, "Verification Plan", 2)
    s.requirements(p, mrd, EO1_MISSION)
    s.requirements(p, srs, EO1_SRS)
    s.verifications(p, ver, EO1_VER)
    s.derive_links()
    # Implemented/verified requirements need their tests to have passed.
    s.items["SY-EPS2"]._demo.state = "V"
    s.items["SY-AOC4"]._demo.state = "V"
    s.advance()
    s.comments(EO1_COMMENTS)

    # Change request on an approved requirement that a passed test verifies:
    # safe mode must now also cope with a faster initial tumble.
    aoc4 = s.items["SY-AOC4"]
    s.run(aoc4, "request_change", "maria",
          comment="Updated attitude profile: safe mode must also hold the Sun within 15° while tumbling at 2 °/s.")
    s.run(aoc4, "accept_change", "jan", comment="Agreed at the weekly system meeting.")
    aoc4.description_md = ("In safe mode the AOCS shall point the solar arrays to within 15° of the Sun using only "
                           "coarse sensors, starting from body rates up to 2 °/s.")
    record_version(db, aoc4, changed_by=s.users["piotr"], reason="edit")
    s.run(aoc4, "submit", "piotr")
    s.run(aoc4, "approve", "jan", comment="Re-approved after CR.")
    db.flush()

    # PDR review with RIDs.
    review = Review(project_id=p.id, key=next_key(db, p.id, "REV"), title="PDR — System Requirements",
                    description="Preliminary design review of the SRS against the mission requirements.",
                    close_requires_resolved="major", require_all_votes=True,
                    created_by_id=s.users["katarzyna"].id, due_date=datetime.now(timezone.utc) + timedelta(days=10))
    db.add(review)
    db.flush()
    for ref in ("SY-AOC1", "SY-AOC2", "SY-OBC2", "SY-COM3", "SY-PAY1", "SY-PAY4", "SY-EPS1", "SY-STR1"):
        review.items.append(ReviewItem(item_id=s.items[ref].id, item_version=s.items[ref].version))
    for who, required in (("maria", True), ("tomasz", True), ("anna", False)):
        review.participants.append(ReviewParticipant(user_id=s.users[who].id, required=required))
        watch(db, s.users[who], "review", review.id)
    db.flush()
    review.participants[0].vote = "approve_with_comments"
    review.participants[0].vote_comment = "OK once the RIDs on AOCS and COM are closed."
    review.participants[0].voted_at = datetime.now(timezone.utc)

    rid1 = sug.create(db, s.items["SY-OBC2"], s.users["tomasz"], target_field="description_md",
                      proposed_value="The flight software shall detect the failure of any single unit and switch to "
                                     "its redundant counterpart within 90 s, with the watchdog timeout set to 45 s.",
                      rationale="VA-OBC2 measured 84 s; 60 s is not achievable with the current watchdog design.",
                      kind="technical", severity="major", review_id=review.id)
    sug.create(db, s.items["SY-COM3"], s.users["maria"], target_field="description_md",
               proposed_value="Payload data shall be encrypted with AES-256-GCM before downlink; keys shall be stored in "
                              "the HSM and rotated at least every 30 days by telecommand.",
               rationale="Key storage and rotation are missing; needed for the security accreditation.",
               kind="technical", severity="major", review_id=review.id)
    rid3 = sug.create(db, s.items["SY-PAY4"], s.users["maria"], target_field="title",
                      proposed_value="Signal-to-noise ratio in all bands",
                      rationale="Title should say the SNR applies to every band, not only PAN.",
                      kind="editorial", severity="minor", review_id=review.id)
    rid4 = sug.create(db, s.items["SY-AOC2"], s.users["tomasz"], target_field="attributes.priority",
                      proposed_value="medium", rationale="Jitter is driven by the payload, already covered elsewhere.",
                      kind="technical", severity="minor", review_id=review.id)
    db.flush()
    wf.execute(db, sug.SuggestionSubject(db, rid3), "accept", s.users["katarzyna"])
    wf.execute(db, sug.SuggestionSubject(db, rid4), "reject", s.users["katarzyna"],
               comment="Jitter directly drives image MTF — stays high.")
    _ = rid1
    db.flush()

    # Library: import GEN-SAT and decide a few records.
    library = db.query(Project).filter_by(kind="library").first()
    release = (db.query(LibraryRelease).filter_by(library_id=library.id).order_by(LibraryRelease.released_at.desc())
               .first() if library else None)
    if library and release:
        p.mission_attributes = {"propulsion": True, "orbit": "LEO"}
        lib.subscribe(db, p, library, release, s.users["katarzyna"], target_document_id=srs.id)
        records = {lib.snapshot_at(db, r.source_item_id, r.source_version)["title"]: r
                   for r in db.query(models.ApplicabilityRecord).filter_by(project_id=p.id).all()}
        dec = s.users["jan"]

        def decide(title, key, comment=None, **payload):
            r = records.get(title)
            if r is not None:
                wf.execute(db, lib.ApplicabilitySubject(db, r), key, dec, comment=comment, payload=payload)

        decide("Battery eclipse autonomy", "mark_applicable")
        decide("Solar array margin", "mark_applicable")
        decide("Thruster control", "mark_applicable")
        decide("Safe mode pointing", "mark_modified",
               comment="EO-1 needs Sun pointing within 15° also from 2 °/s tumbling (see CR on the SRS).",
               document_id=str(srs.id),
               description_md="In safe mode the spacecraft shall point the solar arrays to the Sun within 15° "
                              "starting from body rates up to 2 °/s.")
    db.flush()
    return p


def seed_ip200(s: Seeder) -> Project:
    db = s.db
    p = s.project("SmartInfuse IP-200 Infusion Pump", "IP200")
    s.grant(p, {"katarzyna": "admin", "jan": "editor", "piotr": "editor", "anna": "editor",
                "tomasz": "editor", "maria": "reviewer"})
    # Medical device: regulated workflow (signatures, author ≠ approver,
    # no open comments / Major suggestions, verification needs passed tests).
    user_need = s.types.get("user_need")
    if user_need is None:
        user_need = ItemType(org_id=s.org.id, key="user_need", name="User Need", prefix="UN-",
                             behavior="content", icon="user", color="#9333ea")
        db.add(user_need)
        db.flush()
        for i, (key, label, dt, opts) in enumerate([
            ("priority", "Priority", "enum", ["low", "medium", "high"]),
            ("owner", "Owner", "user_ref", None),
            ("verification_method", "Validation Method", "enum", ["demonstration", "analysis", "inspection", "test"]),
            ("justification", "Source", "rich_text", None),
        ], start=1):
            db.add(ItemTypeAttribute(item_type_id=user_need.id, key=key, label=label, data_type=dt, order=i,
                                     enum_options=[{"value": o, "label": o.title(), "deprecated": False} for o in opts]
                                     if opts else None))
        db.flush()
        db.refresh(user_need)
        ensure_default_workflow(db, user_need)
        s.types["user_need"] = user_need
    for type_key in ("requirement", "user_need"):
        wf.apply_template(db, org_id=s.org.id, item_type_id=s.types[type_key].id,
                          template=ITEM_TEMPLATES["regulated"], project_id=p.id)
    s.parameters(p, IP_PARAMS)
    un = s.document(p, "User Needs", 0, approvers=("jan", "katarzyna"))
    srs = s.document(p, "System Requirements", 1, approvers=("jan", "katarzyna"))
    risk = s.document(p, "Risk Control Measures", 2, approvers=("jan", "katarzyna"))
    vv = s.document(p, "Verification & Validation Plan", 3, approvers=("jan", "katarzyna"))
    s.requirements(p, un, IP_NEEDS, type_key="user_need")
    s.requirements(p, srs, IP_SRS)
    s.requirements(p, risk, IP_RISK)
    s.verifications(p, vv, IP_VER)
    s.derive_links()
    # Requirements with all linked tests passed can go to Verified.
    for ref in ("PS-DEL2", "PS-OCC1", "PS-AIR1", "PS-ALM1", "PS-ALM2", "PS-ALM3", "PS-SW2", "RC-2", "RC-5"):
        s.items[ref]._demo.state = "V"
    s.advance(approver="jan")
    s.comments(IP_COMMENTS)

    review = Review(project_id=p.id, key=next_key(db, p.id, "REV"), title="Design review DR2 — software & connectivity",
                    close_requires_resolved="all", require_all_votes=True, created_by_id=s.users["katarzyna"].id)
    db.add(review)
    db.flush()
    for ref in ("PS-SW1", "PS-SW2", "PS-SW3", "PS-NET1", "PS-NET2", "PS-NET3"):
        review.items.append(ReviewItem(item_id=s.items[ref].id, item_version=s.items[ref].version))
    for who in ("maria", "tomasz"):
        review.participants.append(ReviewParticipant(user_id=s.users[who].id, required=True))
    db.flush()
    sug.create(db, s.items["PS-NET1"], s.users["maria"], target_field="description_md",
               proposed_value="Drug libraries shall be updatable over Wi-Fi from the pharmacy server; the pump shall "
                              "verify the library's digital signature and version before activation and keep the "
                              "previous library until the clinician accepts the new one.",
               rationale="Switching libraries mid-infusion changes limits under the clinician's hands.",
               kind="technical", severity="major", review_id=review.id)
    db.flush()
    return p


def run() -> None:
    mail.send_email = lambda *a, **k: None  # no email flood while seeding
    db = SessionLocal()
    try:
        org = db.query(Organization).filter_by(name="Demo Organization").first() or db.query(Organization).first()
        s = Seeder(db, org)
        s.people()
        db.commit()
        for name, fn in (("EO-1 Earth Observation Smallsat", seed_eo1),
                         ("SmartInfuse IP-200 Infusion Pump", seed_ip200)):
            if db.query(Project).filter_by(name=name).first():
                print(f"'{name}' already exists — skipped.")
                continue
            s.items = {}
            project = fn(s)
            db.commit()
            counts = {
                "requirements": sum(1 for i in s.items.values() if isinstance(getattr(i, "_demo", None), R)),
                "verification activities": sum(1 for i in s.items.values() if isinstance(getattr(i, "_demo", None), V)),
            }
            print(f"Created '{project.name}' ({project.id}): {counts}")
    finally:
        db.close()


if __name__ == "__main__":
    run()

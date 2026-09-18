/**
 * Chapter Review Quiz - backend for a Google Sheet acting as the quiz database.
 * Deploy this as a Web App (container-bound to the Sheet) and paste the
 * deployment URL into js/config.js on the GitHub Pages site.
 *
 * Sheet tabs expected (see setupSheets() and /setup/*.csv):
 *   Config          PacketCode | PacketTitle | JSONFile | Active | TimeLimitMinutes | GradingMode | QuestionLimit
 *   AnswerKeys      PacketCode | QuestionID | Section | Type | CorrectAnswer | Points | Keywords
 *   Results         Timestamp | FullName | Class | PacketCode | ObjectiveScore | ObjectiveMax | EssaySection | EssayMax | EssayScore | FinalScore | TimeTakenSeconds
 *   EssayResponses  Timestamp | FullName | Class | PacketCode | QuestionID | StudentAnswer | ModelAnswer | MaxPoints | ScoreAwarded | GradingSource | Feedback
 *   ActiveSessions  FullName | Class | PacketCode | SelectedQuestionIds | AssignedAt
 *
 * QuestionLimit (Config, optional): if set (>0) and less than the packet's total
 * question count, each student is randomly assigned that many questions the first
 * time they validate their code, sampled proportionally across sections so a short
 * review still touches every question type. The assignment is stored in
 * ActiveSessions so it stays identical across a resume and is what grading uses
 * (not whatever the client sends back), regardless of QuestionLimit.
 *
 * GradingMode (Config) now accepts a third value, 'ai': essay/structured answers
 * are graded by Gemini, called with the STUDENT's own free API key (sent once in
 * their submit request, never stored) so no teacher API key/billing is needed.
 * The model answer stays server-side as before - only the grading call leaves the
 * server, using UrlFetchApp, not the browser, so the answer key is never exposed
 * to the client. See gradeEssayWithGemini() and GEMINI_MODEL below.
 *
 * Admin dashboard (admin.html on the site): reads results via the 'adminResults'
 * action and can overwrite one essay score via 'adminUpdateEssayScore', both
 * gated by an ADMIN_PASSWORD you set yourself in Project Settings > Script
 * Properties (never put the password in this file). See checkAdminPassword().
 *
 * Packet management (admin.html "Packets" tab): packets created from the
 * dashboard (adminCreatePacket) store their question content in the new
 * `Questions` sheet tab instead of a static packets/*.json file - the
 * PacketCode is generated for you, and questions can be added/edited from the
 * dashboard at any time via adminSavePacket, no git commit needed. Each
 * question is a flat row with its own Type (mcq/truefalse/fill/short/essay)
 * chosen individually in the editor - there's no fixed section structure to
 * manage. Sections only exist as a rendering detail for the student-facing
 * quiz: getPacketForStudent() groups questions by type (see TYPE_ORDER below)
 * into "Section N: ..." pages, purely so the quiz UI can paginate. Packets
 * that still have a JSONFile set in Config (like the original NET4-100) keep
 * loading their questions from that static file - only their metadata
 * (title/active/time limit/grading mode/question limit) is editable from the
 * dashboard; edit the JSON file directly to change their question content.
 */

var GEMINI_MODEL = 'gemini-3.6-flash'; // update if Google renames/retires this free-tier model

var SHEET_NAMES = {
  CONFIG: 'Config',
  ANSWER_KEYS: 'AnswerKeys',
  QUESTIONS: 'Questions',
  RESULTS: 'Results',
  ESSAY_RESPONSES: 'EssayResponses',
  ACTIVE_SESSIONS: 'ActiveSessions'
};

/** The 5 question types a dashboard-managed question can be, and the order/title used to group them into student-facing quiz sections. */
var TYPE_ORDER = ['mcq', 'truefalse', 'fill', 'short', 'essay'];
var TYPE_TITLES = {
  mcq: 'Multiple Choice Questions',
  truefalse: 'True or False',
  fill: 'Fill in the Blanks & Short Recall',
  short: 'Scenario-Based Questions',
  essay: 'Exam-Style Structured Questions'
};

/**
 * Embedded copy of packets/chapter4-networks.json (question text/options/marks
 * only, no answers) - used once by migrateChapter4Networks() below to move
 * NET4-100 into the Questions sheet. Keep this in sync if you ever hand-edit
 * that JSON file before running the migration; it is not read at request time
 * otherwise.
 */
var CHAPTER4_NETWORKS_PACKET = {
  "packetCode": "NET4-100",
  "title": "Chapter 4: Networks (100 Questions)",
  "sections": [
    {
      "id": "s1",
      "title": "Section 1: Multiple Choice Questions",
      "type": "mcq",
      "questions": [
        {
          "id": "q1",
          "text": "What is the main purpose of a computer network?",
          "options": {
            "A": "To make computers run faster",
            "B": "To connect computers and allow them to share data and resources",
            "C": "To prevent viruses from entering the computer",
            "D": "To convert analogue signals to digital signals"
          }
        },
        {
          "id": "q2",
          "text": "Which type of network connects computers within a single building or school campus?",
          "options": {
            "A": "WAN",
            "B": "MAN",
            "C": "LAN",
            "D": "PAN"
          }
        },
        {
          "id": "q3",
          "text": "What type of network is created when you connect a smartphone to a wireless speaker and a smartwatch using Bluetooth?",
          "options": {
            "A": "WAN",
            "B": "PAN",
            "C": "LAN",
            "D": "Extranet"
          }
        },
        {
          "id": "q4",
          "text": "What technology does a Wireless LAN (WLAN) use to transmit data between devices?",
          "options": {
            "A": "Fiber optic cables",
            "B": "Copper wires",
            "C": "Radio waves",
            "D": "Infrared light"
          }
        },
        {
          "id": "q5",
          "text": "Which network covers a large geographical area, such as connecting offices across different cities or countries?",
          "options": {
            "A": "LAN",
            "B": "WLAN",
            "C": "PAN",
            "D": "WAN"
          }
        },
        {
          "id": "q6",
          "text": "What is the typical maximum communication range of Bluetooth?",
          "options": {
            "A": "Up to 10 meters",
            "B": "Up to 100 meters",
            "C": "Up to 1 kilometer",
            "D": "Unlimited range"
          }
        },
        {
          "id": "q7",
          "text": "Linking a smartphone to a laptop to share the mobile phone's internet connection is called:",
          "options": {
            "A": "Encapsulation",
            "B": "Tethering",
            "C": "Packet switching",
            "D": "Quarantine"
          }
        },
        {
          "id": "q8",
          "text": "What unique hardware identification number is permanently burned into a Network Interface Card (NIC)?",
          "options": {
            "A": "IP Address",
            "B": "PIN Code",
            "C": "MAC Address",
            "D": "URL Address"
          }
        },
        {
          "id": "q9",
          "text": "Why is a network Hub referred to as a \"dumb\" device?",
          "options": {
            "A": "It cannot be turned on or off",
            "B": "It broadcasts incoming messages to all connected computers",
            "C": "It requires an internet connection to function",
            "D": "It deletes incoming data packets"
          }
        },
        {
          "id": "q10",
          "text": "How does a Switch differ from a Hub?",
          "options": {
            "A": "It connects a LAN directly to a WAN",
            "B": "It reads the destination MAC address and sends data only to the intended recipient",
            "C": "It converts digital data to analogue signals",
            "D": "It only works using wireless signals"
          }
        },
        {
          "id": "q11",
          "text": "Which network device is used to connect two separate segments of the same Local Area Network (LAN)?",
          "options": {
            "A": "Router",
            "B": "Modem",
            "C": "Bridge",
            "D": "Gateway"
          }
        },
        {
          "id": "q12",
          "text": "What primary hardware device connects a local network to the Internet and directs traffic between different networks?",
          "options": {
            "A": "Hub",
            "B": "Switch",
            "C": "Router",
            "D": "Repeater"
          }
        },
        {
          "id": "q13",
          "text": "Which part of a data packet contains the sender and recipient IP addresses?",
          "options": {
            "A": "Payload",
            "B": "Body",
            "C": "Footer",
            "D": "Header"
          }
        },
        {
          "id": "q14",
          "text": "What is the main function of the Footer (Trailer) in a data packet?",
          "options": {
            "A": "To store the main message content",
            "B": "To provide error checking and indicate the end of the packet",
            "C": "To hold the MAC address of the router",
            "D": "To encrypt the IP address"
          }
        },
        {
          "id": "q15",
          "text": "The process of breaking a file into small chunks, sending them across different network routes, and reassembling them at the destination is called:",
          "options": {
            "A": "Circuit switching",
            "B": "Packet switching",
            "C": "Data mining",
            "D": "Asymmetric encryption"
          }
        },
        {
          "id": "q16",
          "text": "What set of protocols governs the transmission of data across the Internet?",
          "options": {
            "A": "HTTP / HTML",
            "B": "TCP / IP",
            "C": "FTP / POP3",
            "D": "SSL / TLS"
          }
        },
        {
          "id": "q17",
          "text": "An Intranet is best described as:",
          "options": {
            "A": "A global public network accessible to everyone worldwide",
            "B": "A private network within an organization accessible only by its members",
            "C": "A temporary network created using Bluetooth",
            "D": "A public Wi-Fi hotspot in an airport"
          }
        },
        {
          "id": "q18",
          "text": "What is an Extranet?",
          "options": {
            "A": "An internal network that has no security password",
            "B": "A network used exclusively for audio conferencing",
            "C": "An extension of an intranet that allows limited access to authorized external users",
            "D": "A satellite network used in deep ocean research"
          }
        },
        {
          "id": "q19",
          "text": "Which of the following is an advantage of Cloud Storage for a business?",
          "options": {
            "A": "Files can be accessed from anywhere with an internet connection",
            "B": "It eliminates the need for an internet connection",
            "C": "Data is completely immune to cyberattacks",
            "D": "Users have 100% control over the physical server hardware"
          }
        },
        {
          "id": "q20",
          "text": "A security device or software that inspects incoming/outgoing network traffic and blocks unauthorized access is a:",
          "options": {
            "A": "Switch",
            "B": "Router",
            "C": "Firewall",
            "D": "Bridge"
          }
        },
        {
          "id": "q21",
          "text": "What type of encryption uses two different keys (a Public Key and a Private Key)?",
          "options": {
            "A": "Symmetric Encryption",
            "B": "Asymmetric Encryption",
            "C": "Caesar Cipher",
            "D": "Hash Function"
          }
        },
        {
          "id": "q22",
          "text": "In Asymmetric Encryption, which key is used to decrypt (unlock) the received message?",
          "options": {
            "A": "The Public Key",
            "B": "The Sender's Public Key",
            "C": "The Private Key",
            "D": "The Shared Master Key"
          }
        },
        {
          "id": "q23",
          "text": "Which password follows the textbook criteria for a STRONG password?",
          "options": {
            "A": "password123",
            "B": "Fajar2026",
            "C": "k9#mP!2$x",
            "D": "qwertyuiop"
          }
        },
        {
          "id": "q24",
          "text": "Which of the following is a Biometric authentication method?",
          "options": {
            "A": "Smart card with a chip",
            "B": "Facial recognition scan",
            "C": "One-Time Password (OTP) physical token",
            "D": "4-digit PIN code"
          }
        },
        {
          "id": "q25",
          "text": "How does a computer Worm differ from a computer Virus?",
          "options": {
            "A": "A worm cannot replicate itself",
            "B": "A worm requires human action to spread",
            "C": "A worm is an independent program that spreads automatically across networks without human action",
            "D": "A worm only targets mobile phones"
          }
        },
        {
          "id": "q26",
          "text": "What type of malware disguises itself as useful, legitimate software to trick users into installing it?",
          "options": {
            "A": "Trojan horse",
            "B": "Worm",
            "C": "Adware",
            "D": "Spyware"
          }
        },
        {
          "id": "q27",
          "text": "What is the primary function of Spyware?",
          "options": {
            "A": "To display unwanted pop-up advertisements",
            "B": "To record keystrokes and secretly monitor user activities",
            "C": "To corrupt the computer BIOS",
            "D": "To physically damage the hard drive"
          }
        },
        {
          "id": "q28",
          "text": "Where does anti-malware software place suspicious, infected files so they cannot harm the rest of the system?",
          "options": {
            "A": "Recycle Bin",
            "B": "System RAM",
            "C": "Quarantine folder",
            "D": "Cloud Backup"
          }
        },
        {
          "id": "q29",
          "text": "What equipment distinguishes Video-conferencing from standard Web-conferencing?",
          "options": {
            "A": "Web-conferencing uses large wall-mounted screens, room cameras, and dedicated private lines",
            "B": "Video-conferencing uses specialized high-quality room equipment and dedicated lines, whereas web-conferencing uses web browsers and laptops",
            "C": "Video-conferencing does not support video transmission",
            "D": "Web-conferencing requires expensive satellite hardware"
          }
        },
        {
          "id": "q30",
          "text": "A one-way, non-interactive video or audio transmission broadcast over the internet is called a:",
          "options": {
            "A": "Webinar",
            "B": "Webcast",
            "C": "VoIP call",
            "D": "Podcast discussion"
          }
        }
      ]
    },
    {
      "id": "s2",
      "title": "Section 2: True or False",
      "type": "truefalse",
      "questions": [
        {
          "id": "q31",
          "text": "The Internet is classified as a global Wide Area Network (WAN)."
        },
        {
          "id": "q32",
          "text": "Bluetooth has a higher data transfer speed and longer range than Wi-Fi."
        },
        {
          "id": "q33",
          "text": "A MAC address changes every time a device connects to a new Wi-Fi network."
        },
        {
          "id": "q34",
          "text": "A Hub reduces unnecessary network traffic compared to a Switch."
        },
        {
          "id": "q35",
          "text": "Routers inspect IP addresses to forward data packets to the correct destination network."
        },
        {
          "id": "q36",
          "text": "In packet switching, all data packets belonging to the same message must travel along the exact same physical route."
        },
        {
          "id": "q37",
          "text": "Intranets can be accessed by any member of the general public without logging in."
        },
        {
          "id": "q38",
          "text": "Storing data on Cloud Storage removes the need for an active internet connection to access files."
        },
        {
          "id": "q39",
          "text": "A Firewall can be implemented as either software or a dedicated hardware device."
        },
        {
          "id": "q40",
          "text": "In Asymmetric Encryption, the Public Key is kept secret while the Private Key is shared openly with everyone."
        },
        {
          "id": "q41",
          "text": "Biometric security systems rely on something the user knows, such as a password or PIN."
        },
        {
          "id": "q42",
          "text": "Computer viruses need to attach themselves to another executable file or program to spread."
        },
        {
          "id": "q43",
          "text": "Adware is software designed to record user passwords by capturing keypresses."
        },
        {
          "id": "q44",
          "text": "Anti-malware software should be updated regularly so it can detect newly created threats."
        },
        {
          "id": "q45",
          "text": "A Webinar is an interactive online teaching session where participants can ask questions to the presenter."
        }
      ]
    },
    {
      "id": "s3",
      "title": "Section 3: Fill in the Blanks & Short Recall",
      "type": "fill",
      "questions": [
        {
          "id": "q46",
          "text": "LAN stands for ____________________."
        },
        {
          "id": "q47",
          "text": "WAN stands for ____________________."
        },
        {
          "id": "q48",
          "text": "A network setup connecting personal mobile devices within a short distance of 1-10 meters is known as a PAN, which stands for ____________________."
        },
        {
          "id": "q49",
          "text": "MAC Address stands for ____________________."
        },
        {
          "id": "q50",
          "text": "The permanent, unique number burned into every Network Interface Card is called a ____________ address."
        },
        {
          "id": "q51",
          "text": "A device that links two separate segments of the same Local Area Network is called a ____________."
        },
        {
          "id": "q52",
          "text": "A data packet consists of three main parts: the Header, the ____________, and the Footer."
        },
        {
          "id": "q53",
          "text": "An IP address stands for ____________________."
        },
        {
          "id": "q54",
          "text": "The global, public system of interconnected computer networks is called the ____________."
        },
        {
          "id": "q55",
          "text": "A private network accessible only by internal employees or members of an organization is an ____________."
        },
        {
          "id": "q56",
          "text": "An intranet extended to grant controlled access to external partners (like suppliers or customers) is an ____________."
        },
        {
          "id": "q57",
          "text": "The process of scrambling data into an unreadable format using a key to keep it secure is called ____________."
        },
        {
          "id": "q58",
          "text": "Authentication using physical biological traits (such as fingerprint or iris scans) is known as ____________."
        },
        {
          "id": "q59",
          "text": "Malicious software specifically designed to secretively spy on user activities and log keypresses is called ____________."
        },
        {
          "id": "q60",
          "text": "Placing an infected or suspicious file into an isolated folder to prevent it from harming the system is called ____________."
        }
      ]
    },
    {
      "id": "s4",
      "title": "Section 4: Scenario-Based Questions",
      "type": "short",
      "questions": [
        {
          "id": "q61",
          "text": "Scenario: A teacher wants to send a printable document from her laptop to a network printer in the room next door without using a USB flash drive. Question: What network type connects these classroom devices together?"
        },
        {
          "id": "q62",
          "text": "Scenario: Farhan is moving around the school library while working on his laptop without losing his internet connection. Question: What wireless network type enables Farhan to stay connected while moving?"
        },
        {
          "id": "q63",
          "text": "Scenario: A small office has 8 computers plugged into a central box. Whenever Computer 1 sends a file to Computer 2, all other 6 computers slow down because they receive the same file data. Question: What \"dumb\" network device is currently installed in this office?"
        },
        {
          "id": "q64",
          "text": "Scenario: The office in Q63 replaces the central box. Now, when Computer 1 sends a file to Computer 2, no extra traffic is sent to the other 6 computers. Question: What \"smart\" network device did they install?"
        },
        {
          "id": "q65",
          "text": "Scenario: A company in Jakarta needs to connect its local office network to its branch office network in London. Question: What primary network hardware device is required at each location to direct traffic across the internet between these two networks?"
        },
        {
          "id": "q66",
          "text": "Scenario: A hospital creates an internal portal where doctors can share patient medical records. Patients cannot log in to this portal from home. Question: What network environment is the hospital using? (Internet, Intranet, or Extranet?)"
        },
        {
          "id": "q67",
          "text": "Scenario: The hospital updates its portal to allow patients to log in securely from their homes to book appointments with doctors. Question: What network environment is being used now? (Internet, Intranet, or Extranet?)"
        },
        {
          "id": "q68",
          "text": "Scenario: A graphic design firm moves all its project files to Google Drive so designers can work from home. However, one day the local internet service goes down, and no one can work. Question: What major disadvantage of cloud storage does this situation highlight?"
        },
        {
          "id": "q69",
          "text": "Scenario: An attacker intercepts data packets moving across a public Wi-Fi network without modifying any system settings or interrupting data flow. Question: What type of cyber attack is this called?"
        },
        {
          "id": "q70",
          "text": "Scenario: An unauthorized user attempts to access a school's internal server from the internet. A security system inspects the incoming IP address, identifies it as untrusted, and blocks the connection. Question: What network defense mechanism performed this action?"
        },
        {
          "id": "q71",
          "text": "Scenario: Alice wants to send a confidential document to Bob using Asymmetric Encryption. Question: Which of Bob's keys should Alice use to encrypt the document?"
        },
        {
          "id": "q72",
          "text": "Scenario: Bob receives the encrypted document from Alice. Question: Which key must Bob use to decrypt and read the document?"
        },
        {
          "id": "q73",
          "text": "Scenario: Student A creates the password \"rover2015\" (Rover is his dog's name). Question: Give two reasons why this password is considered weak according to textbook rules."
        },
        {
          "id": "q74",
          "text": "Scenario: A bank customer inserts a plastic card containing a microchip into an ATM and enters a 4-digit PIN. Question: What type of authentication card is this?"
        },
        {
          "id": "q75",
          "text": "Scenario: A bank sends a 6-digit One-Time Password (OTP) to a customer's smartphone or key fob device to authorize an online transaction. Question: What type of authentication device is being used here?"
        },
        {
          "id": "q76",
          "text": "Scenario: A user receives an email containing a link to download a free popular game. After running the installer, the user's files are suddenly deleted, even though no new windows appear. Question: What type of malware was disguised inside the game installer?"
        },
        {
          "id": "q77",
          "text": "Scenario: A computer on a school network becomes infected. Within 10 minutes, 50 other computers on the same network become infected automatically without any student clicking on any links or opening files. Question: What type of self-replicating malware caused this infection?"
        },
        {
          "id": "q78",
          "text": "Scenario: Every time a user opens a web browser, ten unwanted pop-up windows promoting shopping websites appear on the screen. Question: What type of malware is affecting the computer?"
        },
        {
          "id": "q79",
          "text": "Scenario: A multinational bank holds an international board meeting between executives in Tokyo, London, and New York. They sit in dedicated rooms facing large TV displays with wall-mounted cameras and communicate over a private line. Question: Is this an example of Video-conferencing or Web-conferencing?"
        },
        {
          "id": "q80",
          "text": "Scenario: A university lecturer hosts a live online teaching session over the internet where 100 students join using their web browsers on laptops, view the slides, and type questions in the chat box. Question: What specific type of web-conferencing session is this?"
        }
      ]
    },
    {
      "id": "s5",
      "title": "Section 5: Exam-Style Structured Questions",
      "type": "essay",
      "questions": [
        {
          "id": "q81",
          "text": "State two differences between a LAN and a WAN.",
          "marks": 2
        },
        {
          "id": "q82",
          "text": "Compare Wi-Fi and Bluetooth in terms of range and data transfer speed.",
          "marks": 2
        },
        {
          "id": "q83",
          "text": "Define the term tethering.",
          "marks": 1
        },
        {
          "id": "q84",
          "text": "Explain the role of a Network Interface Card (NIC) in a computer.",
          "marks": 2
        },
        {
          "id": "q85",
          "text": "Explain why a Switch is more efficient than a Hub in managing network traffic.",
          "marks": 2
        },
        {
          "id": "q86",
          "text": "Describe the purpose of a Bridge in a Local Area Network.",
          "marks": 2
        },
        {
          "id": "q87",
          "text": "State the main purpose of a Router.",
          "marks": 1
        },
        {
          "id": "q88",
          "text": "Identify the three main components of a data packet.",
          "marks": 3
        },
        {
          "id": "q89",
          "text": "Explain how packet switching works when transferring a file across the internet.",
          "marks": 3
        },
        {
          "id": "q90",
          "text": "Describe the difference between an IP Address and a MAC Address.",
          "marks": 2
        },
        {
          "id": "q91",
          "text": "Differentiate between an Intranet and an Extranet.",
          "marks": 2
        },
        {
          "id": "q92",
          "text": "State two advantages and two disadvantages of using Cloud Storage.",
          "marks": 4
        },
        {
          "id": "q93",
          "text": "Describe how a Firewall protects a network from unauthorized access.",
          "marks": 2
        },
        {
          "id": "q94",
          "text": "Explain how Asymmetric Encryption works to keep data secure during transmission.",
          "marks": 3
        },
        {
          "id": "q95",
          "text": "List four characteristics of a strong password.",
          "marks": 4
        },
        {
          "id": "q96",
          "text": "Explain how Biometric authentication works and give one example.",
          "marks": 2
        },
        {
          "id": "q97",
          "text": "Describe two differences between a computer Virus and a computer Worm.",
          "marks": 2
        },
        {
          "id": "q98",
          "text": "Explain the function of Anti-malware software and what Quarantine means.",
          "marks": 3
        },
        {
          "id": "q99",
          "text": "Distinguish between Video-conferencing and Web-conferencing in terms of hardware and network requirements.",
          "marks": 2
        },
        {
          "id": "q100",
          "text": "Define a Webcast and explain how it differs from a Webinar.",
          "marks": 2
        }
      ]
    }
  ]
};

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'validate') {
    return jsonOutput(validateToken(e.parameter));
  }
  if (action === 'packet') {
    return jsonOutput(getPacketForStudent(e.parameter.code));
  }
  return jsonOutput({ success: false, error: 'unknown_action' });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput({ success: false, error: 'bad_request' });
  }
  if (body.action === 'submit') {
    return jsonOutput(submitQuiz(body));
  }
  if (body.action === 'adminResults') {
    return jsonOutput(adminGetResults(body));
  }
  if (body.action === 'adminUpdateEssayScore') {
    return jsonOutput(adminUpdateEssayScore(body));
  }
  if (body.action === 'adminListPackets') {
    return jsonOutput(adminListPackets(body));
  }
  if (body.action === 'adminGetPacket') {
    return jsonOutput(adminGetPacket(body));
  }
  if (body.action === 'adminCreatePacket') {
    return jsonOutput(adminCreatePacket(body));
  }
  if (body.action === 'adminSavePacket') {
    return jsonOutput(adminSavePacket(body));
  }
  return jsonOutput({ success: false, error: 'unknown_action' });
}

/**
 * Checks a submitted password against the ADMIN_PASSWORD script property.
 * Set this once via the Apps Script editor: Project Settings (gear icon) >
 * Script Properties > Add property. Never commit the password into Code.gs.
 */
function checkAdminPassword(password) {
  var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!stored) return false;
  return norm(password) === stored;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function norm(value) {
  return (value === undefined || value === null) ? '' : value.toString().trim();
}

function normLower(value) {
  return norm(value).toLowerCase();
}

/** Reads Config tab into an array of row objects. */
function readConfigRows() {
  var sheet = getSheet(SHEET_NAMES.CONFIG);
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!norm(r[0])) continue;
    out.push({
      packetCode: norm(r[0]),
      title: norm(r[1]),
      jsonFile: norm(r[2]),
      active: (r[3] === true) || (normLower(r[3]) === 'true'),
      timeLimitMinutes: Number(r[4]) || 30,
      gradingMode: ['auto', 'ai'].indexOf(normLower(r[5])) !== -1 ? normLower(r[5]) : 'manual',
      questionLimit: Number(r[6]) || 0
    });
  }
  return out;
}

function findConfigByCode(code) {
  var rows = readConfigRows();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].packetCode.toLowerCase() === code.toLowerCase()) return rows[i];
  }
  return null;
}

/** Checks the Results tab for an existing submission by this student for this packet. */
function hasExistingSubmission(fullName, className, packetCode) {
  var sheet = getSheet(SHEET_NAMES.RESULTS);
  var rows = sheet.getDataRange().getValues();
  var fn = normLower(fullName), cl = normLower(className), pc = normLower(packetCode);
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (normLower(r[1]) === fn && normLower(r[2]) === cl && normLower(r[3]) === pc) return true;
  }
  return false;
}

/** Looks up a previously-assigned question subset for this student+packet, if any. Returns an array of ids, or null. */
function getAssignedQuestionIds(fullName, className, packetCode) {
  var sheet = getSheet(SHEET_NAMES.ACTIVE_SESSIONS);
  var rows = sheet.getDataRange().getValues();
  var fn = normLower(fullName), cl = normLower(className), pc = normLower(packetCode);
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (normLower(r[0]) === fn && normLower(r[1]) === cl && normLower(r[2]) === pc) {
      var ids = norm(r[3]).split(',').map(function (id) { return id.trim(); }).filter(Boolean);
      return ids.length > 0 ? ids : null;
    }
  }
  return null;
}

function recordAssignedQuestionIds(fullName, className, packetCode, ids) {
  var sheet = getSheet(SHEET_NAMES.ACTIVE_SESSIONS);
  sheet.appendRow([fullName, className, packetCode, ids.join(','), new Date()]);
}

function shuffle(array) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

/**
 * Randomly samples `limit` question ids out of this packet's AnswerKeys rows,
 * proportionally across each Section value so short reviews still cover every
 * question type. Returns null if limit is 0/unset or >= the total question count
 * (meaning: no limiting needed, use every question).
 */
function sampleQuestionIds(packetCode, limit) {
  var keyRows = readAnswerKeyRows(packetCode);
  if (!limit || limit <= 0 || limit >= keyRows.length) return null;

  var bySection = {};
  var sectionOrder = [];
  keyRows.forEach(function (k) {
    if (!bySection[k.section]) {
      bySection[k.section] = [];
      sectionOrder.push(k.section);
    }
    bySection[k.section].push(k.questionId);
  });

  var total = keyRows.length;
  var targets = sectionOrder.map(function (section) {
    var groupSize = bySection[section].length;
    return { section: section, raw: (limit * groupSize) / total, count: 0 };
  });
  targets.forEach(function (t) { t.count = Math.floor(t.raw); });

  var assigned = targets.reduce(function (sum, t) { return sum + t.count; }, 0);
  var remainder = limit - assigned;
  targets.sort(function (a, b) { return (b.raw - b.count) - (a.raw - a.count); });
  for (var i = 0; i < remainder && i < targets.length; i++) {
    targets[i].count++;
  }

  var selected = [];
  targets.forEach(function (t) {
    var pool = shuffle(bySection[t.section].slice());
    var take = Math.min(t.count, pool.length);
    selected = selected.concat(pool.slice(0, take));
  });

  return selected;
}

function validateToken(params) {
  var code = norm(params.code);
  var fullName = norm(params.fullName);
  var className = norm(params.class);

  if (!code || !fullName || !className) {
    return { success: false, error: 'missing_fields' };
  }

  var config = findConfigByCode(code);
  if (!config) {
    return { success: false, error: 'invalid_code' };
  }
  if (!config.active) {
    return { success: false, error: 'inactive_code' };
  }
  if (hasExistingSubmission(fullName, className, config.packetCode)) {
    return { success: false, error: 'already_submitted' };
  }

  var selectedQuestionIds = null;
  if (config.questionLimit > 0) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      selectedQuestionIds = getAssignedQuestionIds(fullName, className, config.packetCode);
      if (!selectedQuestionIds) {
        selectedQuestionIds = sampleQuestionIds(config.packetCode, config.questionLimit);
        if (selectedQuestionIds) {
          recordAssignedQuestionIds(fullName, className, config.packetCode, selectedQuestionIds);
        }
      }
    } finally {
      lock.releaseLock();
    }
  }

  return {
    success: true,
    packetCode: config.packetCode,
    title: config.title,
    jsonFile: config.jsonFile,
    timeLimitMinutes: config.timeLimitMinutes,
    gradingMode: config.gradingMode,
    selectedQuestionIds: selectedQuestionIds
  };
}

/** Loose match for short-recall answers: normalizes punctuation/case and checks containment or word overlap. */
function looseMatch(student, correct) {
  var a = normLower(student).replace(/[^a-z0-9\s]/g, '').trim();
  var b = normLower(correct).replace(/[^a-z0-9\s]/g, '').trim();
  if (!a || !b) return false;
  if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;

  var aWords = a.split(/\s+/).filter(function (w) { return w.length > 2; });
  var bWords = b.split(/\s+/).filter(function (w) { return w.length > 2; });
  if (bWords.length === 0) return false;
  var common = 0;
  for (var i = 0; i < bWords.length; i++) {
    if (aWords.indexOf(bWords[i]) !== -1) common++;
  }
  return (common / bWords.length) >= 0.6;
}

/** Best-effort keyword-overlap score for auto-graded essay answers. */
function keywordScore(student, keywordsStr, maxPoints) {
  var keywords = norm(keywordsStr).split(',').map(function (k) { return k.trim().toLowerCase(); }).filter(Boolean);
  if (keywords.length === 0) return 0;
  var text = normLower(student);
  if (!text) return 0;
  var matched = 0;
  for (var i = 0; i < keywords.length; i++) {
    if (text.indexOf(keywords[i]) !== -1) matched++;
  }
  var ratio = matched / keywords.length;
  return Math.round(ratio * maxPoints * 2) / 2; // round to nearest 0.5
}

/**
 * Grades one essay answer using Gemini, called with the student's own API key.
 * Retries automatically on HTTP 503/429 (Google's own error text says these are
 * "usually temporary") with short backoff, since free-tier keys hit these under
 * load fairly often. Fails fast (no retry) on anything else - a bad key or a
 * malformed response won't be fixed by trying again. Throws after exhausting
 * retries - caller must catch and fall back to manual review.
 */
function gradeEssayWithGemini(apiKey, modelAnswer, maxPoints, studentAnswer) {
  var backoffMs = [0, 1000, 2500];
  var lastError;
  for (var attempt = 0; attempt < backoffMs.length; attempt++) {
    if (backoffMs[attempt]) Utilities.sleep(backoffMs[attempt]);
    try {
      return gradeEssayWithGeminiOnce(apiKey, modelAnswer, maxPoints, studentAnswer);
    } catch (err) {
      lastError = err;
      if (!err.retryable) throw err;
    }
  }
  throw lastError;
}

function gradeEssayWithGeminiOnce(apiKey, modelAnswer, maxPoints, studentAnswer) {
  var prompt = 'You are grading a student\'s short written answer for an ICT (IGCSE-style) class.\n' +
    'Marking guide / model answer: ' + modelAnswer + '\n' +
    'Maximum marks available: ' + maxPoints + '\n' +
    'Student\'s answer: ' + (studentAnswer || '(no answer given)') + '\n\n' +
    'Award a score out of ' + maxPoints + ' based on how well the student\'s answer covers the key points in the marking guide. Give partial credit for partially correct answers. ' +
    'Respond with ONLY JSON in this exact shape: {"score": <number from 0 to ' + maxPoints + '>, "feedback": "<one short sentence explaining the score>"}';

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + encodeURIComponent(apiKey);
  var payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0 }
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    var code = res.getResponseCode();
    var httpErr = new Error('Gemini API HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
    httpErr.retryable = (code === 503 || code === 429);
    throw httpErr;
  }

  var data = JSON.parse(res.getContentText());
  var text = data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text;
  if (!text) throw new Error('Gemini API returned no content (possibly blocked by safety filters)');

  var parsed = JSON.parse(text);
  var score = Number(parsed.score);
  if (isNaN(score)) throw new Error('Gemini API returned a non-numeric score');
  score = Math.max(0, Math.min(maxPoints, score));

  return { score: Math.round(score * 2) / 2, feedback: norm(parsed.feedback).slice(0, 500) };
}

/**
 * Returns grading data (correct answers/points/keywords) for a packet.
 * Static (JSONFile) packets keep using the legacy AnswerKeys sheet; packets
 * created from the admin dashboard have no JSONFile and are graded from the
 * Questions sheet instead (see readQuestionRows()).
 */
function readAnswerKeyRows(packetCode) {
  var config = findConfigByCode(packetCode);
  if (config && !config.jsonFile) {
    return readQuestionRows(packetCode).map(function (q) {
      return {
        questionId: q.questionId,
        section: q.type,
        type: q.type,
        correctAnswer: q.correctAnswer,
        points: q.points,
        keywords: q.keywords
      };
    });
  }
  return readLegacyAnswerKeyRows(packetCode);
}

function readLegacyAnswerKeyRows(packetCode) {
  var sheet = getSheet(SHEET_NAMES.ANSWER_KEYS);
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (normLower(r[0]) !== normLower(packetCode)) continue;
    out.push({
      questionId: norm(r[1]),
      section: norm(r[2]),
      type: normLower(r[3]),
      correctAnswer: norm(r[4]),
      points: Number(r[5]) || 0,
      keywords: norm(r[6])
    });
  }
  return out;
}

/** Reads every Questions-sheet row for one packet (raw, admin-only fields included) as a flat list, in the admin's authored order. */
function readQuestionRows(packetCode) {
  var sheet = getSheet(SHEET_NAMES.QUESTIONS);
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (normLower(r[0]) !== normLower(packetCode)) continue;
    var options = null;
    if (norm(r[5])) {
      try { options = JSON.parse(r[5]); } catch (e) { options = null; }
    }
    out.push({
      packetCode: norm(r[0]),
      questionId: norm(r[1]),
      type: normLower(r[2]),
      orderIndex: Number(r[3]) || 0,
      text: norm(r[4]),
      options: options,
      correctAnswer: norm(r[6]),
      points: Number(r[7]) || 0,
      keywords: norm(r[8])
    });
  }
  out.sort(function (a, b) { return a.orderIndex - b.orderIndex; });
  return out;
}

/** Groups a flat question list into quiz sections by type (mcq, truefalse, fill, short, essay, in that fixed order), skipping types with no questions. Numbered titles are generated fresh each time so they stay sequential regardless of which types are present. */
function groupIntoSections(questionRows) {
  var byType = {};
  questionRows.forEach(function (q) {
    if (!byType[q.type]) byType[q.type] = [];
    byType[q.type].push(q);
  });
  var sections = [];
  TYPE_ORDER.forEach(function (type) {
    var rows = byType[type] || [];
    if (rows.length === 0) return;
    sections.push({ type: type, questions: rows });
  });
  sections.forEach(function (s, idx) {
    s.title = 'Section ' + (idx + 1) + ': ' + TYPE_TITLES[s.type];
  });
  return sections;
}

/** Builds the student-facing packet (no answers/points/keywords) for a dashboard-managed packet. */
function getPacketForStudent(code) {
  code = norm(code);
  var config = findConfigByCode(code);
  if (!config) return { success: false, error: 'invalid_code' };
  if (config.jsonFile) return { success: false, error: 'static_packet' };

  var sections = groupIntoSections(readQuestionRows(config.packetCode)).map(function (s) {
    return {
      id: s.type,
      title: s.title,
      type: s.type,
      questions: s.questions.map(function (q) {
        var out = { id: q.questionId, text: q.text };
        if (s.type === 'mcq' && q.options) out.options = q.options;
        if (s.type === 'essay' && q.points) out.marks = q.points;
        return out;
      })
    };
  });

  return { success: true, packetCode: config.packetCode, title: config.title, sections: sections };
}

function submitQuiz(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var fullName = norm(body.fullName);
    var className = norm(body.class);
    var packetCode = norm(body.packetCode);
    var answers = body.answers || {};
    var timeTakenSeconds = Number(body.timeTakenSeconds) || 0;
    var geminiApiKey = norm(body.geminiApiKey);

    if (!fullName || !className || !packetCode) {
      return { success: false, error: 'missing_fields' };
    }
    if (hasExistingSubmission(fullName, className, packetCode)) {
      return { success: false, error: 'already_submitted' };
    }

    var config = findConfigByCode(packetCode);
    if (!config) {
      return { success: false, error: 'invalid_code' };
    }

    var keyRows = readAnswerKeyRows(packetCode);
    if (config.questionLimit > 0) {
      var assignedIds = getAssignedQuestionIds(fullName, className, packetCode);
      if (assignedIds) {
        var assignedSet = {};
        assignedIds.forEach(function (id) { assignedSet[id] = true; });
        keyRows = keyRows.filter(function (k) { return assignedSet[k.questionId]; });
      }
    }
    var objectiveScore = 0, objectiveMax = 0;
    var essayMax = 0, hasEssay = false, essayCount = 0;
    var essayRowsToWrite = [];
    var essayScoreTotal = 0;
    var aiGradedCount = 0;

    for (var i = 0; i < keyRows.length; i++) {
      var key = keyRows[i];
      var studentAnswer = norm(answers[key.questionId]);

      if (key.type === 'mcq' || key.type === 'truefalse') {
        objectiveMax += key.points;
        if (normLower(studentAnswer) === normLower(key.correctAnswer)) {
          objectiveScore += key.points;
        }
      } else if (key.type === 'fill' || key.type === 'short') {
        objectiveMax += key.points;
        if (looseMatch(studentAnswer, key.correctAnswer)) {
          objectiveScore += key.points;
        }
      } else if (key.type === 'essay') {
        hasEssay = true;
        essayCount++;
        essayMax += key.points;
        var scoreAwarded = '';
        var gradingSource = 'Manual';
        var feedback = '';

        if (config.gradingMode === 'auto') {
          scoreAwarded = keywordScore(studentAnswer, key.keywords, key.points);
          gradingSource = 'Keyword';
          essayScoreTotal += scoreAwarded;
        } else if (config.gradingMode === 'ai') {
          if (geminiApiKey) {
            try {
              var graded = gradeEssayWithGemini(geminiApiKey, key.correctAnswer, key.points, studentAnswer);
              scoreAwarded = graded.score;
              feedback = graded.feedback;
              gradingSource = 'AI';
              essayScoreTotal += scoreAwarded;
              aiGradedCount++;
            } catch (aiErr) {
              feedback = 'AI grading failed: ' + aiErr.message;
              gradingSource = 'Manual (AI failed)';
            }
          } else {
            feedback = 'No API key was provided.';
            gradingSource = 'Manual (no API key)';
          }
        }

        essayRowsToWrite.push([
          new Date(), fullName, className, packetCode,
          key.questionId, studentAnswer, key.correctAnswer, key.points,
          scoreAwarded, gradingSource, feedback
        ]);
      }
    }

    if (essayRowsToWrite.length > 0) {
      var essaySheet = getSheet(SHEET_NAMES.ESSAY_RESPONSES);
      essaySheet.getRange(essaySheet.getLastRow() + 1, 1, essayRowsToWrite.length, 11).setValues(essayRowsToWrite);
    }

    var essaySectionStatus = 'N/A';
    if (hasEssay) {
      if (config.gradingMode === 'auto') {
        essaySectionStatus = 'Auto-Estimated';
      } else if (config.gradingMode === 'ai') {
        if (aiGradedCount === essayCount) essaySectionStatus = 'AI-Graded';
        else if (aiGradedCount > 0) essaySectionStatus = 'AI-Graded (partial - some pending review)';
        else essaySectionStatus = 'Pending Review';
      } else {
        essaySectionStatus = 'Pending Review';
      }
    }

    var resultsSheet = getSheet(SHEET_NAMES.RESULTS);
    resultsSheet.appendRow([
      new Date(), fullName, className, packetCode,
      objectiveScore, objectiveMax, essaySectionStatus, essayMax,
      '', '', timeTakenSeconds
    ]);
    var lastRow = resultsSheet.getLastRow();
    // EssayScore (col I / 9): live SUMIFS against EssayResponses so manual grades update automatically.
    resultsSheet.getRange(lastRow, 9).setFormula(
      '=IFERROR(SUMIFS(EssayResponses!I:I, EssayResponses!B:B, B' + lastRow + ', EssayResponses!C:C, C' + lastRow + ', EssayResponses!D:D, D' + lastRow + '),0)'
    );
    // FinalScore (col J / 10) = ObjectiveScore (E) + EssayScore (I).
    resultsSheet.getRange(lastRow, 10).setFormula('=E' + lastRow + '+I' + lastRow);

    return {
      success: true,
      objectiveScore: objectiveScore,
      objectiveMax: objectiveMax,
      essaySectionStatus: essaySectionStatus,
      essayScore: hasEssay && (config.gradingMode === 'auto' || aiGradedCount > 0) ? essayScoreTotal : null,
      essayMax: essayMax
    };
  } finally {
    lock.releaseLock();
  }
}

/** Returns every Results row (optionally filtered to one packet), each with its essay Q&A attached, for the admin dashboard. */
function adminGetResults(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }

  var packetFilter = norm(body.packetCode);

  var essaySheet = getSheet(SHEET_NAMES.ESSAY_RESPONSES);
  var essayRows = essaySheet.getDataRange().getValues();
  var essayByKey = {};
  for (var i = 1; i < essayRows.length; i++) {
    var er = essayRows[i];
    if (!norm(er[1])) continue;
    var key = normLower(er[1]) + '|' + normLower(er[2]) + '|' + normLower(er[3]);
    if (!essayByKey[key]) essayByKey[key] = [];
    essayByKey[key].push({
      questionId: norm(er[4]),
      studentAnswer: norm(er[5]),
      modelAnswer: norm(er[6]),
      maxPoints: Number(er[7]) || 0,
      scoreAwarded: er[8] === '' ? null : Number(er[8]),
      gradingSource: norm(er[9]),
      feedback: norm(er[10])
    });
  }

  var resultsSheet = getSheet(SHEET_NAMES.RESULTS);
  var resultRows = resultsSheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < resultRows.length; i++) {
    var r = resultRows[i];
    if (!norm(r[1])) continue;
    var packetCode = norm(r[3]);
    if (packetFilter && normLower(packetCode) !== normLower(packetFilter)) continue;

    var key = normLower(r[1]) + '|' + normLower(r[2]) + '|' + normLower(packetCode);
    results.push({
      timestamp: (r[0] instanceof Date) ? r[0].toISOString() : norm(r[0]),
      fullName: norm(r[1]),
      className: norm(r[2]),
      packetCode: packetCode,
      objectiveScore: Number(r[4]) || 0,
      objectiveMax: Number(r[5]) || 0,
      essaySection: norm(r[6]),
      essayMax: Number(r[7]) || 0,
      essayScore: Number(r[8]) || 0,
      finalScore: Number(r[9]) || 0,
      timeTakenSeconds: Number(r[10]) || 0,
      essays: essayByKey[key] || []
    });
  }
  results.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  var packets = readConfigRows().map(function (c) { return { packetCode: c.packetCode, title: c.title }; });

  return { success: true, results: results, packets: packets };
}

/** Overwrites one essay question's ScoreAwarded (and marks it as a manual override) from the admin dashboard. */
function adminUpdateEssayScore(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }

  var fullName = norm(body.fullName);
  var className = norm(body.class);
  var packetCode = norm(body.packetCode);
  var questionId = norm(body.questionId);
  var score = Number(body.score);

  if (!fullName || !className || !packetCode || !questionId || isNaN(score)) {
    return { success: false, error: 'missing_fields' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet(SHEET_NAMES.ESSAY_RESPONSES);
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (normLower(r[1]) === normLower(fullName) && normLower(r[2]) === normLower(className) &&
        normLower(r[3]) === normLower(packetCode) && norm(r[4]) === questionId) {
        sheet.getRange(i + 1, 9).setValue(score);
        sheet.getRange(i + 1, 10).setValue('Manual (override)');
        return { success: true };
      }
    }
    return { success: false, error: 'not_found' };
  } finally {
    lock.releaseLock();
  }
}

/** Returns every packet's Config row plus a question count, for the admin dashboard's Packets list. */
function adminListPackets(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }
  var configRows = readConfigRows();
  var questionsSheet = getSheet(SHEET_NAMES.QUESTIONS);
  var allQuestionRows = questionsSheet.getDataRange().getValues();
  var counts = {};
  for (var i = 1; i < allQuestionRows.length; i++) {
    var code = normLower(norm(allQuestionRows[i][0]));
    if (!code) continue;
    counts[code] = (counts[code] || 0) + 1;
  }
  var packets = configRows.map(function (c) {
    return {
      packetCode: c.packetCode,
      title: c.title,
      active: c.active,
      timeLimitMinutes: c.timeLimitMinutes,
      gradingMode: c.gradingMode,
      questionLimit: c.questionLimit,
      isStatic: !!c.jsonFile,
      jsonFile: c.jsonFile,
      questionCount: c.jsonFile ? null : (counts[normLower(c.packetCode)] || 0)
    };
  });
  return { success: true, packets: packets };
}

/** Returns one packet's full editable content (including answers) for the admin dashboard's packet editor. */
function adminGetPacket(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }
  var config = findConfigByCode(norm(body.packetCode));
  if (!config) return { success: false, error: 'not_found' };

  var questions = null;
  if (!config.jsonFile) {
    questions = readQuestionRows(config.packetCode).map(function (q) {
      return {
        id: q.questionId,
        type: q.type,
        text: q.text,
        options: q.options,
        correctAnswer: q.correctAnswer,
        points: q.points,
        keywords: q.keywords
      };
    });
  }

  return {
    success: true,
    packet: {
      packetCode: config.packetCode,
      title: config.title,
      active: config.active,
      timeLimitMinutes: config.timeLimitMinutes,
      gradingMode: config.gradingMode,
      questionLimit: config.questionLimit,
      isStatic: !!config.jsonFile,
      jsonFile: config.jsonFile,
      questions: questions
    }
  };
}

/** Generates a unique, human-readable PacketCode from a title, e.g. "Chapter 5: Databases" -> "CHAPTER-5-7F3K". */
function generatePacketCode(title) {
  var base = norm(title).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  var parts = base.split('-').filter(Boolean);
  var prefix = parts.slice(0, 2).join('-').slice(0, 18) || 'PACKET';

  var existing = {};
  readConfigRows().forEach(function (c) { existing[c.packetCode.toUpperCase()] = true; });

  var code;
  do {
    var suffix = Utilities.getUuid().replace(/-/g, '').toUpperCase().slice(0, 4);
    code = prefix + '-' + suffix;
  } while (existing[code]);
  return code;
}

function findConfigRowIndex(sheet, code) {
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (normLower(rows[i][0]) === normLower(code)) return i + 1; // 1-based sheet row
  }
  return -1;
}

/**
 * Creates a brand-new, dashboard-managed packet: generates a unique PacketCode,
 * appends a Config row (Active=FALSE until the teacher turns it on, no JSONFile
 * so it's graded/served from the Questions sheet), and no questions yet - the
 * teacher adds those via adminSavePacket right after.
 */
function adminCreatePacket(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }
  var title = norm(body.title);
  if (!title) return { success: false, error: 'missing_title' };

  var packetCode = generatePacketCode(title);
  var timeLimitMinutes = Number(body.timeLimitMinutes) || 30;
  var gradingMode = ['auto', 'ai'].indexOf(normLower(body.gradingMode)) !== -1 ? normLower(body.gradingMode) : 'manual';
  var questionLimit = Number(body.questionLimit) || 0;

  var sheet = getSheet(SHEET_NAMES.CONFIG);
  sheet.appendRow([packetCode, title, '', false, timeLimitMinutes, gradingMode, questionLimit]);

  return { success: true, packetCode: packetCode };
}

/**
 * Saves a packet's metadata (and, for dashboard-managed packets, its full
 * question content). Static (JSONFile) packets only get their metadata
 * updated here - their questions live in packets/*.json and are edited by
 * committing to the repo, not through this endpoint.
 */
function adminSavePacket(body) {
  if (!checkAdminPassword(body.adminPassword)) {
    return { success: false, error: 'unauthorized' };
  }
  var packetCode = norm(body.packetCode);
  var config = findConfigByCode(packetCode);
  if (!config) return { success: false, error: 'not_found' };

  var meta = body.meta || {};
  var title = norm(meta.title) || config.title;
  var active = !!meta.active;
  var timeLimitMinutes = Number(meta.timeLimitMinutes) || 30;
  var gradingMode = ['auto', 'ai'].indexOf(normLower(meta.gradingMode)) !== -1 ? normLower(meta.gradingMode) : 'manual';
  var questionLimit = Number(meta.questionLimit) || 0;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var configSheet = getSheet(SHEET_NAMES.CONFIG);
    var rowIndex = findConfigRowIndex(configSheet, packetCode);
    if (rowIndex === -1) return { success: false, error: 'not_found' };
    configSheet.getRange(rowIndex, 2, 1, 6).setValues([[title, config.jsonFile, active, timeLimitMinutes, gradingMode, questionLimit]]);

    if (!config.jsonFile && Array.isArray(body.questions)) {
      writeQuestionsForPacket(packetCode, body.questions);
    }
  } finally {
    lock.releaseLock();
  }

  return { success: true };
}

/** Replaces every Questions-sheet row for one packet with the given flat questions payload, preserving existing question ids and assigning fresh ones to new questions. */
function writeQuestionsForPacket(packetCode, questionsPayload) {
  var sheet = getSheet(SHEET_NAMES.QUESTIONS);
  var allRows = sheet.getDataRange().getValues();
  var header = allRows[0];

  var kept = [];
  for (var i = 1; i < allRows.length; i++) {
    if (normLower(allRows[i][0]) !== normLower(packetCode)) kept.push(allRows[i]);
  }

  var newRows = buildQuestionRows(packetCode, questionsPayload);
  var finalRows = kept.concat(newRows);

  sheet.clearContents();
  sheet.getRange(1, 1, 1, header.length).setValues([header]);
  if (finalRows.length > 0) {
    sheet.getRange(2, 1, finalRows.length, header.length).setValues(finalRows);
  }
}

/** Turns an admin-submitted flat questions payload into Questions-sheet rows, coercing each question's fields to sane values for its own chosen type. */
function buildQuestionRows(packetCode, questionsPayload) {
  var maxNum = 0;
  questionsPayload.forEach(function (q) {
    var m = /^q(\d+)$/.exec(norm(q.id));
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  var nextNum = maxNum + 1;

  var rows = [];
  questionsPayload.forEach(function (q, orderIdx) {
    var text = norm(q.text);
    if (!text) return; // drop blank/unfilled question cards

    var type = TYPE_ORDER.indexOf(normLower(q.type)) !== -1 ? normLower(q.type) : 'mcq';
    var questionId = /^q\d+$/.test(norm(q.id)) ? norm(q.id) : ('q' + (nextNum++));
    var optionsJson = '';
    var correctAnswer = norm(q.correctAnswer);
    var points = Number(q.points) || 1;
    var keywords = norm(q.keywords);

    if (type === 'mcq') {
      var options = {};
      var letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      letters.forEach(function (letter) {
        var val = q.options && norm(q.options[letter]);
        if (val) options[letter] = val;
      });
      var filledLetters = Object.keys(options);
      if (filledLetters.indexOf(correctAnswer.toUpperCase()) === -1) {
        correctAnswer = filledLetters[0] || 'A';
      } else {
        correctAnswer = correctAnswer.toUpperCase();
      }
      optionsJson = JSON.stringify(options);
    } else if (type === 'truefalse') {
      correctAnswer = correctAnswer.toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE';
    }

    rows.push([
      packetCode, questionId, type, orderIdx,
      text, optionsJson, correctAnswer, points, keywords
    ]);
  });
  return rows;
}

/**
 * ONE-TIME MIGRATION: moves the original NET4-100 packet from its static
 * packets/chapter4-networks.json file + the legacy AnswerKeys sheet into the
 * Questions sheet, so it becomes fully editable from the admin dashboard's
 * Packets tab like any packet created there. Run this once from the Apps
 * Script editor (Run > migrateChapter4Networks), then check View > Logs (or
 * View > Executions) for a summary. Safe to re-run - it's a no-op once
 * NET4-100's JSONFile is already blank.
 */
function migrateChapter4Networks() {
  var packetCode = 'NET4-100';
  var config = findConfigByCode(packetCode);
  if (!config) {
    Logger.log('No Config row found for ' + packetCode + ' - nothing to migrate.');
    return;
  }
  if (!config.jsonFile) {
    Logger.log(packetCode + ' is already dashboard-managed (JSONFile is blank) - nothing to do.');
    return;
  }

  var answerByQuestionId = {};
  readLegacyAnswerKeyRows(packetCode).forEach(function (a) {
    answerByQuestionId[a.questionId] = a;
  });

  var questionsPayload = [];
  CHAPTER4_NETWORKS_PACKET.sections.forEach(function (section) {
    section.questions.forEach(function (q) {
      var key = answerByQuestionId[q.id];
      if (!key) {
        Logger.log('WARNING: no AnswerKeys row found for ' + q.id + ' - it will be saved with a blank correct answer.');
      }
      var out = {
        id: q.id,
        type: section.type,
        text: q.text,
        correctAnswer: key ? key.correctAnswer : '',
        points: key ? key.points : (q.marks || 1),
        keywords: key ? key.keywords : ''
      };
      if (q.options) out.options = q.options;
      questionsPayload.push(out);
    });
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeQuestionsForPacket(packetCode, questionsPayload);
    var configSheet = getSheet(SHEET_NAMES.CONFIG);
    var rowIndex = findConfigRowIndex(configSheet, packetCode);
    configSheet.getRange(rowIndex, 3).setValue(''); // clear JSONFile - now dashboard-managed
  } finally {
    lock.releaseLock();
  }

  Logger.log('Migrated ' + packetCode + ': ' + questionsPayload.length + ' questions moved into the Questions sheet. JSONFile cleared - it is now editable from the admin dashboard\'s Packets tab.');
}

/** Run this once from the Apps Script editor (Run > setupSheets) to create the tabs with headers. */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var specs = [
    { name: SHEET_NAMES.CONFIG, headers: ['PacketCode', 'PacketTitle', 'JSONFile', 'Active', 'TimeLimitMinutes', 'GradingMode', 'QuestionLimit'] },
    { name: SHEET_NAMES.ANSWER_KEYS, headers: ['PacketCode', 'QuestionID', 'Section', 'Type', 'CorrectAnswer', 'Points', 'Keywords'] },
    // forceHeader: true - the Questions schema is still evolving, so setupSheets always corrects row 1 to match, even if it already has (older) headers. Only safe because this sheet has no data yet; if you've already added real questions when upgrading Code.gs, back them up first.
    { name: SHEET_NAMES.QUESTIONS, headers: ['PacketCode', 'QuestionID', 'Type', 'OrderIndex', 'Text', 'OptionsJSON', 'CorrectAnswer', 'Points', 'Keywords'], forceHeader: true },
    { name: SHEET_NAMES.RESULTS, headers: ['Timestamp', 'FullName', 'Class', 'PacketCode', 'ObjectiveScore', 'ObjectiveMax', 'EssaySection', 'EssayMax', 'EssayScore', 'FinalScore', 'TimeTakenSeconds'] },
    { name: SHEET_NAMES.ESSAY_RESPONSES, headers: ['Timestamp', 'FullName', 'Class', 'PacketCode', 'QuestionID', 'StudentAnswer', 'ModelAnswer', 'MaxPoints', 'ScoreAwarded', 'GradingSource', 'Feedback'] },
    { name: SHEET_NAMES.ACTIVE_SESSIONS, headers: ['FullName', 'Class', 'PacketCode', 'SelectedQuestionIds', 'AssignedAt'] }
  ];
  specs.forEach(function (spec) {
    var sheet = ss.getSheetByName(spec.name);
    if (!sheet) sheet = ss.insertSheet(spec.name);
    if (spec.forceHeader || sheet.getRange(1, 1).getValue() === '') {
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
      sheet.setFrozenRows(1);
    }
  });
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    var isEmpty = defaultSheet.getDataRange().getA1Notation() === 'A1' && defaultSheet.getRange(1, 1).getValue() === '';
    if (isEmpty) ss.deleteSheet(defaultSheet);
  }
}

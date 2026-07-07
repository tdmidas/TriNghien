"""Security topic catalog for the prompt-bar topic selector.

Every topic here is deliberately dataset-driven: experiments are offline
analyses over CSV/parquet/HF datasets (classification, detection, robustness
evaluation), so no complex sandbox / vulnerable-lab environment is required.
Each topic carries context that is injected into the pipeline prompts.
"""

TOPICS = [
    {
        "id": "web-security",
        "name": "Web Security",
        "icon": "globe",
        "description": "Phát hiện tấn công web từ dữ liệu: SQLi/XSS payload classification, malicious URL detection, web log anomaly detection.",
        "prompt_context": (
            "Domain: Web security, dataset-driven only (no live exploitation, no vulnerable lab). "
            "Typical tasks: SQL injection / XSS payload classification, malicious URL detection, "
            "HTTP request anomaly detection from logs (e.g. CSIC 2010), phishing website detection. "
            "Suggested public datasets: CSIC-2010 web attacks, malicious-URLs datasets on HuggingFace/Kaggle, "
            "PhishTank-derived phishing URL datasets."
        ),
    },
    {
        "id": "blockchain-security",
        "name": "Blockchain Security",
        "icon": "link",
        "description": "Phát hiện lỗ hổng smart contract từ source/bytecode, phát hiện gian lận giao dịch on-chain.",
        "prompt_context": (
            "Domain: Blockchain security, dataset-driven only. Typical tasks: smart-contract "
            "vulnerability classification from Solidity source or bytecode (e.g. SmartBugs, SolidiFI datasets), "
            "Ethereum fraud/phishing account detection from transaction-graph features, "
            "Ponzi contract detection. No chain deployment or live testing."
        ),
    },
    {
        "id": "malware-analysis",
        "name": "Malware Detection (Static)",
        "icon": "bug",
        "description": "Phân loại malware từ đặc trưng tĩnh: PE headers, API-call sequences, opcode n-grams (không thực thi mẫu).",
        "prompt_context": (
            "Domain: Static malware detection — features only, NEVER execute samples. "
            "Typical tasks: PE-header based classification (EMBER, BODMAS), Android malware from "
            "permissions/API calls (Drebin, CICAndMal), malware family classification from opcode or "
            "API-call sequences. All experiments operate on pre-extracted feature datasets."
        ),
    },
    {
        "id": "network-intrusion",
        "name": "Network Intrusion Detection",
        "icon": "network",
        "description": "IDS trên flow features: NSL-KDD, CIC-IDS2017, UNSW-NB15 — phân loại tấn công, phát hiện bất thường.",
        "prompt_context": (
            "Domain: Network intrusion detection on tabular flow datasets. "
            "Typical tasks: multi-class attack classification and anomaly detection on NSL-KDD, "
            "CIC-IDS2017/2018, UNSW-NB15; class-imbalance handling; feature importance analysis. "
            "No packet capture or live traffic generation needed."
        ),
    },
    {
        "id": "phishing-spam",
        "name": "Phishing & Spam Detection",
        "icon": "mail",
        "description": "Phát hiện email phishing/spam, SMS smishing bằng NLP; so sánh feature-based vs LLM-based.",
        "prompt_context": (
            "Domain: Phishing/spam detection with NLP. Typical tasks: email phishing classification "
            "(Enron-spam, Nazario phishing corpora on HuggingFace), SMS spam (UCI SMS Spam), "
            "URL+content hybrid features, comparing classic ML vs transformer embeddings vs LLM zero-shot."
        ),
    },
    {
        "id": "adversarial-ml",
        "name": "Adversarial ML / Model Security",
        "icon": "shield",
        "description": "Tấn công đối kháng & phòng thủ trên model ML: evasion trên tabular/image classifier, robustness eval.",
        "prompt_context": (
            "Domain: Adversarial machine learning, self-contained experiments. Typical tasks: "
            "FGSM/PGD evasion attacks against classifiers trained on public datasets (MNIST/CIFAR-10 small subsets, "
            "or tabular IDS models), adversarial-training defense evaluation, transferability studies. "
            "Everything runs inside one training script — no external infrastructure."
        ),
    },
    {
        "id": "llm-security",
        "name": "LLM Security (Dataset-based)",
        "icon": "brain",
        "description": "Phát hiện prompt injection/jailbreak từ dataset công khai, đánh giá guardrail classifier.",
        "prompt_context": (
            "Domain: LLM security evaluated on public datasets (no live model red-teaming needed unless "
            "the chosen OpenRouter model is used as a classifier). Typical tasks: prompt-injection / "
            "jailbreak prompt classification (e.g. deepset/prompt-injections, jackhhao/jailbreak-classification "
            "on HuggingFace), toxicity/guardrail benchmark comparison, detection-rule evaluation."
        ),
    },
    {
        "id": "password-auth",
        "name": "Password & Authentication Security",
        "icon": "key",
        "description": "Phân tích độ mạnh mật khẩu từ leaked-password corpora, phát hiện credential-stuffing pattern trong log.",
        "prompt_context": (
            "Domain: Authentication security from data. Typical tasks: password-strength modelling on "
            "public leaked-password corpora (RockYou), guessability estimation, login-log anomaly "
            "detection for credential stuffing. Strictly offline analysis of public research datasets."
        ),
    },
    # --- Extension domains (the plugin layer's whole point). These carry an
    # isolated-runner recipe in recipes.py and ship disabled: selectable so the
    # extension surface is visible, but blocked at Execute until an isolated,
    # network-denied runner is provisioned. The pipeline designs the paper as
    # normal, then refuses to run rather than executing offensive/live code loose.
    {
        "id": "malware-dynamic",
        "name": "Malware Detection (Dynamic) — isolated",
        "icon": "bug",
        "description": "Phân tích hành vi malware trong sandbox VM cô lập (Cuckoo/YARA). Yêu cầu runner cô lập mạng — mặc định khóa.",
        "extension": True,
        "prompt_context": (
            "Domain: Dynamic malware detection. Samples are detonated ONLY inside a network-isolated "
            "sandbox VM (Cuckoo) with egress denied; experiments reduce the behavioural report "
            "(API-call trace, dropped files, network attempts) to a feature table and detection "
            "metrics. Never execute, unpack, or exfiltrate a sample outside the sandbox."
        ),
    },
    {
        "id": "multi-agent-pentest",
        "name": "Multi-Agent Pentest (Lab) — isolated",
        "icon": "shield",
        "description": "Agent LLM đánh giá trên target lab cố ý có lỗ hổng (Metasploitable/DVWA) trong mạng cô lập. Yêu cầu runner cô lập — mặc định khóa.",
        "extension": True,
        "prompt_context": (
            "Domain: Multi-agent penetration-testing evaluation. Agents act ONLY against intentionally "
            "vulnerable lab targets (Metasploitable/DVWA) inside an isolated subnet with no route to the "
            "internet; never target any address outside the lab. Measure services discovered, "
            "vulnerabilities confirmed, exploitation success rate, and steps/tokens per agent under a "
            "fixed per-agent budget."
        ),
    },
]

TOPIC_IDS = {t["id"] for t in TOPICS}


def get_topic(topic_id: str) -> dict:
    for t in TOPICS:
        if t["id"] == topic_id:
            return t
    return {
        "id": topic_id or "general",
        "name": topic_id or "General AI Security",
        "prompt_context": "Domain: general AI-security research, dataset-driven experiments only.",
    }

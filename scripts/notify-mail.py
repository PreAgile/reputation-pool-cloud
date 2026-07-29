#!/usr/bin/env python3
"""메일 알림 발송 (#15) — OCI Email Delivery SMTP 경유.

사용:
    echo "본문" | ./scripts/notify-mail.py "제목"
    ./scripts/notify-mail.py "제목" --body "본문"

설정 파일(기본 ``~/.rp-mail.env``, ``RP_MAIL_ENV`` 로 변경):

    SMTP_HOST=smtp.email.ap-tokyo-1.oci.oraclecloud.com
    SMTP_PORT=587
    SMTP_USER=ocid1.user...@ocid1.tenancy....bt.com
    SMTP_PASS=...
    MAIL_FROM=noreply@poolroost.com
    MAIL_TO=someone@example.com          # 쉼표로 여러 명

왜 파이썬인가: 서버에 MTA 를 두지 않기 위해서다. OCI 는 25번 아웃바운드를 막고, 직접 발송하는
메일은 Gmail 이 거의 확실히 거부한다. OCI Email Delivery 는 하루 100통이 영구 무료이고
(체험 크레딧 만료와 무관하다) SPF/DKIM 을 붙일 수 있어 스팸 처리되지 않는다.

왜 설정 파일을 셸로 ``source`` 하지 않는가: SMTP 비밀번호에 ``[``·``$`` 같은 문자가 섞이면
셸이 그걸 해석해 값이 잘린다(실제로 첫 시도가 그렇게 실패했다 — 인증 오류로만 보여서 원인이
비밀번호 자체인지 파싱인지 구분되지 않았다). ``pull-deploy.sh`` 가 ``.env`` 를 source 하지 않는
것과 같은 이유다.

종료 코드: 0 성공 / 1 발송 실패 / 2 설정 없음·불완전.
호출자가 셋을 구분해 로그에 남길 수 있도록 나눠 둔다 — "알림이 안 갔다" 를 조용히 넘기면
정작 알림이 필요한 순간에 아무도 모른다.
"""

import argparse
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formatdate

REQUIRED = ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "MAIL_FROM", "MAIL_TO")


def load_config(path):
    cfg = {}
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                value = value.strip()
                # 감싼 따옴표만 벗긴다. 값 안의 따옴표는 그대로 둔다.
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                cfg[key.strip()] = value
    except FileNotFoundError:
        return None
    return cfg


def main():
    parser = argparse.ArgumentParser(description="OCI Email Delivery 로 알림 메일을 보낸다")
    parser.add_argument("subject")
    parser.add_argument("--body", help="본문. 없으면 stdin 을 읽는다")
    parser.add_argument("--config", default=os.environ.get("RP_MAIL_ENV", "~/.rp-mail.env"))
    args = parser.parse_args()

    cfg = load_config(args.config)
    if cfg is None:
        print("notify-mail: 설정 파일이 없다: %s" % args.config, file=sys.stderr)
        return 2
    missing = [k for k in REQUIRED if not cfg.get(k)]
    if missing:
        print("notify-mail: 설정이 비었다: %s" % ", ".join(missing), file=sys.stderr)
        return 2

    body = args.body if args.body is not None else sys.stdin.read()

    msg = EmailMessage()
    msg["From"] = cfg["MAIL_FROM"]
    msg["To"] = cfg["MAIL_TO"]
    msg["Subject"] = args.subject
    msg["Date"] = formatdate(localtime=True)
    msg.set_content(body)

    try:
        server = smtplib.SMTP(cfg["SMTP_HOST"], int(cfg["SMTP_PORT"]), timeout=30)
        try:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.login(cfg["SMTP_USER"], cfg["SMTP_PASS"])
            server.send_message(msg)
        finally:
            try:
                server.quit()
            except Exception:
                pass
    except Exception as exc:  # noqa: BLE001 - 어떤 실패든 호출자에게 한 줄로 알린다
        print("notify-mail: 발송 실패: %s: %s" % (type(exc).__name__, exc), file=sys.stderr)
        return 1

    print("notify-mail: 발송 완료 -> %s" % cfg["MAIL_TO"])
    return 0


if __name__ == "__main__":
    sys.exit(main())

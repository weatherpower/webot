#!/bin/sh
# Live Control (port 8899) only for the addresses in /opt/weatherpower/allowed-ips.txt.
# Docker bypasses ufw for published ports, so these rules hook into the DOCKER-USER chain.
IF=$(ip -o -4 route show default | awk '{print $5; exit}')
iptables -N WP-LIVECONTROL 2>/dev/null || iptables -F WP-LIVECONTROL
grep -vE '^[[:space:]]*(#|$)' /opt/weatherpower/allowed-ips.txt | while read -r ip; do
  iptables -A WP-LIVECONTROL -s "$ip" -j RETURN
done
iptables -A WP-LIVECONTROL -j DROP
iptables -C DOCKER-USER -i "$IF" -p tcp -m conntrack --ctorigdstport 8899 -j WP-LIVECONTROL 2>/dev/null \
  || iptables -I DOCKER-USER -i "$IF" -p tcp -m conntrack --ctorigdstport 8899 -j WP-LIVECONTROL

#!/bin/sh
set -eu
[ "$(docker info --format '{{.ID}}')" = '342f251a-9e56-4353-af12-a32429b7a2e7' ]
private_bridge=br-$(docker network inspect hambazi-staging-private --format '{{.Id}}' | cut -c1-12)
egress_bridge=br-$(docker network inspect hambazi-staging-bot-egress --format '{{.Id}}' | cut -c1-12)
[ "$(ip -4 route show default | awk '{print $5}')" = eth0 ]
[ "$(cat /proc/sys/net/bridge/bridge-nf-call-iptables)" = 1 ]
rollback=/opt/hambazi-staging/private/execution-20261008/firewall-rollback.sh
if [ "${1:-}" != reload ]; then
  [ ! -e "$rollback" ]
  umask 077
  cat > "$rollback" <<'EOF'
#!/bin/sh
for pair in 'iptables INPUT HBZ18B3-IN' 'iptables DOCKER-USER HBZ18B3-FWD' 'ip6tables INPUT HBZ18B3-V6IN' 'ip6tables FORWARD HBZ18B3-V6FWD'; do
 set -- $pair
 "$1" -w -D "$2" -j "$3" 2>/dev/null || true
 "$1" -w -F "$3" 2>/dev/null || true
 "$1" -w -X "$3" 2>/dev/null || true
done
EOF
  chmod 700 "$rollback"
  systemd-run --quiet --unit=hambazi-staging-firewall-rollback --on-active=5m "$rollback"
fi
for name in HBZ18B3-IN HBZ18B3-FWD; do iptables -w -N "$name" 2>/dev/null || true; iptables -w -F "$name"; done
for name in HBZ18B3-V6IN HBZ18B3-V6FWD; do ip6tables -w -N "$name" 2>/dev/null || true; ip6tables -w -F "$name"; done
iptables -w -A HBZ18B3-IN -i lo -j ACCEPT
iptables -w -A HBZ18B3-IN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -w -A HBZ18B3-IN -i eth0 -p icmp -j ACCEPT
iptables -w -A HBZ18B3-IN -i eth0 -p tcp -m multiport --dports 22,80,443 -j ACCEPT
iptables -w -A HBZ18B3-IN -i eth0 -j DROP
iptables -w -A HBZ18B3-IN -j RETURN
iptables -w -A HBZ18B3-FWD -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for target in '8080 80' '8443 443'; do
 set -- $target
 for addr in 10.89.18.2 10.89.19.3; do
  iptables -w -A HBZ18B3-FWD -i eth0 -d "$addr" -p tcp --dport "$1" -m conntrack --ctstate NEW --ctorigdst 185.110.191.104 --ctorigdstport "$2" -j RETURN
 done
done
iptables -w -A HBZ18B3-FWD -i eth0 -j DROP
iptables -w -A HBZ18B3-FWD -s 10.89.19.0/24 -o eth0 -p tcp --dport 443 -j RETURN
iptables -w -A HBZ18B3-FWD -s 10.89.19.0/24 -o eth0 -p udp --dport 53 -j RETURN
iptables -w -A HBZ18B3-FWD -s 10.89.19.0/24 -o eth0 -p tcp --dport 53 -j RETURN
iptables -w -A HBZ18B3-FWD -s 10.89.19.0/24 -o eth0 -j DROP
for flow in '10.89.18.2 10.89.18.10 8080' '10.89.18.2 10.89.18.13 8080' '10.89.18.2 10.89.18.11 9444' '10.89.18.11 10.89.18.10 9443' '10.89.18.10 10.89.18.20 5432' '10.89.18.12 10.89.18.20 5432' '10.89.18.10 10.89.18.21 6379' '10.89.18.12 10.89.18.21 6379'; do
 set -- $flow
 iptables -w -A HBZ18B3-FWD -i "$private_bridge" -o "$private_bridge" -s "$1" -d "$2" -p tcp --dport "$3" -j RETURN
done
iptables -w -A HBZ18B3-FWD -i "$private_bridge" -o "$private_bridge" -s 10.89.18.0/24 -d 10.89.18.0/24 -j DROP
iptables -w -A HBZ18B3-FWD -j RETURN
ip6tables -w -A HBZ18B3-V6IN -i lo -j ACCEPT
ip6tables -w -A HBZ18B3-V6IN -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -w -A HBZ18B3-V6IN -i eth0 -p ipv6-icmp -j ACCEPT
ip6tables -w -A HBZ18B3-V6IN -i eth0 -p tcp --dport 22 -j ACCEPT
ip6tables -w -A HBZ18B3-V6IN -i eth0 -j DROP
ip6tables -w -A HBZ18B3-V6IN -j RETURN
ip6tables -w -A HBZ18B3-V6FWD -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
ip6tables -w -A HBZ18B3-V6FWD -i eth0 -j DROP
ip6tables -w -A HBZ18B3-V6FWD -j RETURN
for pair in 'iptables INPUT HBZ18B3-IN' 'iptables DOCKER-USER HBZ18B3-FWD' 'ip6tables INPUT HBZ18B3-V6IN' 'ip6tables FORWARD HBZ18B3-V6FWD'; do
 set -- $pair
 "$1" -w -C "$2" -j "$3" 2>/dev/null || "$1" -w -I "$2" 1 -j "$3"
done
printf '%s\n' FIREWALL_APPLIED_SECOND_SSH_REQUIRED

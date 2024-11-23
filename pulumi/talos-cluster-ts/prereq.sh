#!/usr/bin/env bash
#
#
#

CLOUD=${1:-"default"}

# Check if an argument is provided
if [ $# -eq 0 ]; then
  echo "Usage: $0 <your_argument>"
  exit 1
fi

if [ -f "openstack-amd64.raw" ]; then
  echo "File exists. Moving onto next step"
else
  echo "downloading file..."
  wget https://factory.talos.dev/image/88d1f7a5c4f1d3aba7df787c448c1d3d008ed29cfb34af53fa0df4336a56040b/v1.8.2/openstack-amd64.raw.xz
  xz --decompress -v openstack-amd64.raw.xz
fi

openstack --os-cloud ${CLOUD} image create \
  --progress \
  --disk-format raw \
  --container-format bare \
  --file openstack-amd64.raw \
  --property hw_vif_multiqueue_enabled=true \
  --property hw_qemu_guest_agent=yes \
  --property hypervisor_type=kvm \
  --property img_config_drive=optional \
  --property hw_machine_type=q35 \
  --property hw_firmware_type=uefi \
  --property os_require_quiesce=yes \
  --property os_type=linux \
  --property os_admin_user=talos \
  --property os_distro=talos \
  --property os_version=18.2 \
  --tag "siderolabs/iscsi-tools" \
  --tag "siderolabs/util-linux-tools" \
  --tag "siderolabs/qemu-guest-agent" \
  talos-1.8.2

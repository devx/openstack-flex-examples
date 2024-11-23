# Makefile for managing Pulumi operations and cluster bootstrap

# Default target: help
.PHONY: help
help:
	@echo "Usage:"
	@echo "  make delete            - Executes 'pulumi destroy -y'"
	@echo "  make deploy            - Executes 'pulumi up -y'"
	@echo "  make preview           - Executes 'pulumi preview'"
	@echo "  make bootstrap         - Initiates Talos cluster bootstrap"
	@echo "  make deploy-bootstrap  - Executes 'deploy' followed by 'bootstrap'"

# Target to destroy resources
.PHONY: delete
delete:
	pulumi destroy -y

# Target to deploy resources
.PHONY: deploy
deploy:
	pulumi up -y

# Target to preview resource changes
.PHONY: preview
preview:
	pulumi preview

# Target to bootstrap the Talos cluster
.PHONY: bootstrap
bootstrap:
	@echo "\n\n---------------- Generating talosconfig file ----------------"
	pulumi stack output talosConfiguration --show-secrets > talosconfig
	@echo "\n\n---------------- Exporting bastion IP ----------------"
	export BASTION=$$(pulumi stack output bastion_ip) && \
		scp -o StrictHostKeyChecking=no talosconfig debian@$${BASTION}:~/ && \
		echo "\n\n---------------- Initiating the cluster bootstrap ----------------" && \
		ssh debian@$${BASTION} "talosctl --talosconfig talosconfig bootstrap" && \
		echo "\nSleeping for 50 seconds ..." && \
		sleep 50 && \
		echo "\n\n---------------- Listing services ----------------" && \
		ssh debian@$${BASTION} "talosctl --talosconfig talosconfig service" && \
		echo "\n\n---------------- Listing member and their status ----------------" && \
		ssh debian@$${BASTION} "talosctl --talosconfig ./talosconfig get members" && \
		echo "\n\n---------------- Downloading kubeconfig ----------------" && \
		ssh debian@$${BASTION} "talosctl --talosconfig talosconfig kubeconfig ~/.kube/config" && \
		ssh debian@$${BASTION} "kubectl get nodes" && \
		echo "\n\n---------------- Deploy and Bootstrap Completed ----------------"

# Target to deploy and then bootstrap the cluster
.PHONY: deploy-bootstrap
deploy-bootstrap: deploy bootstrap

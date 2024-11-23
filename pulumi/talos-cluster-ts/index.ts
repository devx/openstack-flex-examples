import * as pulumi from "@pulumi/pulumi";
import * as os from "@pulumi/openstack";
import * as talos from "@pulumiverse/talos";


const config = new pulumi.Config();

const clusterName = config.require("clusterName");
const tenantSubnetCIDR = config.require("tenantSubnetCIDR");
const serverFlavor = config.require("bastion_server_flavor");
const imageName = config.require("bastion_image_name");

// Get External Network
const externalNetworkName = config.require("externalNetworkName");
const extNet = pulumi.output(
  os.networking.getNetwork({
        name: externalNetworkName,
    })
);

// create the public keypair 
const ssh_public_key = config.require("ssh_public_key");

// Create a key pair for SSH access
const keypair = new os.compute.Keypair(`${clusterName}-keypair`, {
    name: `${clusterName}-key`,
    publicKey: ssh_public_key,
});

// Create a Internal Tenant network
const tenantNetwork = new os.networking.Network(
    `${clusterName}-internal-tenant-network`,
    {
        name: `${clusterName}-internal-tenant-network`,
        adminStateUp: true,
        tags: [clusterName],
    }
);

// Create an internal tenant subnet within the newly created tenant network
const tenantSubnet = new os.networking.Subnet(
    `${clusterName}-tenant-subnet`,
    {
        name: `${clusterName}-tenant-subnet`,
        networkId: tenantNetwork.id,
        cidr: tenantSubnetCIDR,
        ipVersion: 4,
        dnsNameservers: ["8.8.8.8"],
        tags: [clusterName],
    }
);

// Create a router to connect the private network to the public network
const router = new os.networking.Router(`${clusterName}-router`, {
    adminStateUp: true,
    externalNetworkId: extNet.id,
    tags: [clusterName],
});

const routerInterface = new os.networking.RouterInterface(
    `${clusterName}-routerInterface`,
    {
        routerId: router.id,
        subnetId: tenantSubnet.id,
    }
);

//
// Security Group section and rules
//

// Create a security group
const secGroup = new os.networking.SecGroup(`${clusterName}-secGroup`, {
    name: `${clusterName}-secGroup`,
    description: `Security group for ${clusterName} control plane`,
    tags: [clusterName],
});

// Allow SSH Port 22
new os.networking.SecGroupRule(`${clusterName}-allow_22_port`, {
    direction: "ingress",
    ethertype: "IPv4",
    portRangeMax: 22,
    portRangeMin: 22,
    protocol: "tcp",
    remoteIpPrefix: "0.0.0.0/0",
    securityGroupId: secGroup.id,
});

new os.networking.SecGroupRule(`${clusterName}-allow_6443_port`, {
    direction: "ingress",
    ethertype: "IPv4",
    portRangeMax: 6443,
    portRangeMin: 6443,
    protocol: "tcp",
    remoteIpPrefix: "0.0.0.0/0",
    securityGroupId: secGroup.id,
});

new os.networking.SecGroupRule(`${clusterName}-allow_50000_port`, {
    direction: "ingress",
    ethertype: "IPv4",
    portRangeMax: 50000,
    portRangeMin: 50000,
    protocol: "tcp",
    remoteIpPrefix: "0.0.0.0/0",
    securityGroupId: secGroup.id,
});

new os.networking.SecGroupRule(`${clusterName}-allow_50001_port`, {
    direction: "ingress",
    ethertype: "IPv4",
    portRangeMax: 50001,
    portRangeMin: 50001,
    protocol: "tcp",
    remoteIpPrefix: "0.0.0.0/0",
    securityGroupId: secGroup.id,
});

const tcpIngressRule = new os.networking.SecGroupRule(`${clusterName}-tcpIngressRule`, {
    direction: "ingress",
    ethertype: "IPv4", // or "IPv6" if needed
    protocol: "tcp",
    securityGroupId: secGroup.id,
});

const udpIngressRule = new os.networking.SecGroupRule(`${clusterName}-udpIngressRule`, {
    direction: "ingress",
    ethertype: "IPv4", // or "IPv6" if needed
    protocol: "udp",
    securityGroupId: secGroup.id,
});


//
// Create a bastion server that will be used to interact with our Talos cluster
//

const bastionPort = new os.networking.Port(`${clusterName}-port`, {
    name: `${clusterName}-port`,
    networkId: tenantNetwork.id,
    fixedIps: [{ subnetId: tenantSubnet.id }],
    securityGroupIds: [secGroup.id],
    tags: [clusterName],
});

const bastionServer = new os.compute.Instance(`${clusterName}-bastion`, {
    name: `${clusterName}-bastion`,
    flavorName: serverFlavor,
    imageName: imageName,
    keyPair: keypair.name,
    availabilityZone: "nova",
    tags: [clusterName],
    networks: [{ port: bastionPort.id }],
    userData: `#!/bin/bash
apt-get update
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
mv kubectl /usr/local/bin
chmod +x /usr/local/bin/kubectl
curl -sL https://talos.dev/install | sh
`,
});

// Assign Floating IP to Load Balancer
const bastionFIP = new os.networking.FloatingIp(`${clusterName}-bastion_fip`,
  {
    description: clusterName,
    pool: externalNetworkName,
    portId: bastionPort.id,
    tags: [clusterName],
  }
);

export const bastion_ip = bastionFIP.address;
//
// Create Additional Network Infrastructure to deploy a talos linux cluster
//


// Create Load Balancer
const loadBalancer = new os.loadbalancer.LoadBalancer(`${clusterName}-lb`, {
  vipSubnetId: tenantSubnet.id,
  loadbalancerProvider: "ovn",
  tags: [clusterName],
});


// Create Listener on port 443
const talosControlPlaneListener = new os.loadbalancer.Listener(`${clusterName}-controlPlane-listener`, {
    name: `${clusterName}-controlPlane-listener`,
    loadbalancerId: loadBalancer.id,
    protocol: "TCP",
    protocolPort: 443,
    tags: [clusterName],
});

// Create Pool
const pool = new os.loadbalancer.Pool(`${clusterName}-controlPlane-pool`, {
    name: `${clusterName}-controlPlane-pool`,
    lbMethod: "SOURCE_IP_PORT",
    listenerId: talosControlPlaneListener.id,
    protocol: "TCP",
});

// Create Health Monitor
const healthMonitor = new os.loadbalancer.Monitor(`${clusterName}-controlPlane-health_monitor`, {
    poolId: pool.id,
    delay: 5,
    maxRetries: 4,
    timeout: 10,
    type: "TCP",
});

// Assign Floating IP to Load Balancer
const loadBalancerVIP = new os.networking.FloatingIp(`${clusterName}-loadBalancer-vip`,
  {
    description: clusterName,
    pool: externalNetworkName,
    portId: loadBalancer.vipPortId,
    tags: [clusterName],
  }
);

export const talosClusterIP: pulumi.Output<string> = pulumi.interpolate`https://${loadBalancerVIP.address}:443`;
//
// Create the talos cluster configuration
//

const talosSecrets = new talos.machine.Secrets("talos-secrets", {});


export const talosControlPlaneConfig = talos.machine.getConfigurationOutput({
    clusterName: clusterName,
    machineType: "controlplane",
    clusterEndpoint: talosClusterIP,
    machineSecrets: talosSecrets.machineSecrets,
    examples: true,
});


export const talosWorkerConfig = talos.machine.getConfigurationOutput({
    clusterName: clusterName,
    machineType: "worker",
    clusterEndpoint: talosClusterIP,
    machineSecrets: talosSecrets.machineSecrets,
});


//
// This section creates the Talos Linux Cluster
//


function createPort(
    serverName: string,
    tenantNetwork: pulumi.Input<string>,
    tenantSubnet: pulumi.Input<string>,
    secGroup: pulumi.Input<string>
): os.networking.Port {
    return new os.networking.Port(`${serverName}-port`, {
        name: `${serverName}-port`,
        networkId: tenantNetwork,
        fixedIps: [{ subnetId: tenantSubnet }],
        securityGroupIds: [secGroup],
    });
}

function createServer(
    serverName: string,
    port: os.networking.Port,
    keypair: pulumi.Input<string>,
    nodeType: string,
    serverFlavor: string,
    clusterName: pulumi.Input<string>,
): os.compute.Instance {
    // Read the user data from file
    let userDataFile = nodeType === "worker"
        ? talosWorkerConfig.machineConfiguration
        : talosControlPlaneConfig.machineConfiguration;
    const userData = userDataFile;

    return new os.compute.Instance(serverName, {
        imageName: "talos-1.8.2",
        name: serverName,
        flavorName: serverFlavor,
        keyPair: keypair,
        networks: [{ port: port.id }],
        userData: userData,
        tags: [clusterName],
    });
}

function updateLbMembers(
    server: os.compute.Instance,
    poolId: pulumi.Input<string>,
    serverName: string
): os.loadbalancer.Member {
    return new os.loadbalancer.Member(serverName, {
        poolId: poolId,
        address: server.accessIpV4,
        protocolPort: 6443,
    });
}

function createServers(
    tenantNetwork: pulumi.Input<string>,
    tenantSubnet: pulumi.Input<string>,
    extNet: pulumi.Input<string>,
    secGroup: pulumi.Input<string>,
    keypair: pulumi.Input<string>,
    nodeType: string,
    numNodes: number,
    serverFlavor: string,
): os.compute.Instance[] {
    const serverNames: string[] = [];
    for (let i = 1; i <= numNodes; i++) {
        serverNames.push(`${clusterName}_${nodeType}-${i}`);
    }

    const servers: os.compute.Instance[] = [];

    for (const serverName of serverNames) {
        const port = createPort(serverName, tenantNetwork, tenantSubnet, secGroup);
        const server = createServer(serverName, port, keypair, nodeType, serverFlavor, clusterName);
        servers.push(server);

        if (nodeType === "control_plane") {
            updateLbMembers(server, pool.id, serverName);
        }
    }

    return servers;
}

// Create Control Plane Servers
const controlPlaneServers = createServers(
    tenantNetwork.id,
    tenantSubnet.id,
    extNet.id,
    secGroup.id,
    keypair.id,
    "control_plane",
    3,
    "gp.0.4.8",
);

// Create Worker Servers
const workerServers = createServers(
    tenantNetwork.id,
    tenantSubnet.id,
    extNet.id,
    secGroup.id,
    keypair.id,
    "worker",
    3,
    "gp.0.4.8",
);

const talosContolPlaneNode = controlPlaneServers[0].accessIpV4;
//const talosContolPlaneNode: pulumi.Output<string> = controlPlaneServers[0];

const talosConfig = talos.client.getConfigurationOutput({
    clusterName: clusterName,
    clientConfiguration: talosSecrets.clientConfiguration,
    nodes: [ talosContolPlaneNode ],
    endpoints: [ talosContolPlaneNode ],
});

export const talosConfiguration = talosConfig.talosConfig

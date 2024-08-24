import axios from 'axios';
import sdk, {
    DeviceProvider,
    ScryptedDeviceBase,
    ScryptedInterface,
    ScryptedDeviceType,
    ScryptedNativeId,
    OnOff,
    Settings,
    Setting,
    SettingValue
} from '@scrypted/sdk';

class RachioSmartHoseTimer extends ScryptedDeviceBase implements OnOff {
    constructor(private plugin: RachioSmartHoseTimerPlugin, nativeId?: string) {
        super(nativeId);
    }
    async turnOff(): Promise<void> {
        if (!this.nativeId) { throw new Error('No valve Id has been set'); }
        this.plugin.turnOffValve(this.nativeId)
    }
    async turnOn(): Promise<void> {
        if (!this.nativeId) { throw new Error('No valve Id has been set'); }
        this.plugin.turnOnValve(this.nativeId)    
    }

    release() {
        this.console.log(`Releasing device ${this.nativeId}`);
    }
}

class RachioSmartHoseTimerPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
    constructor(nativeId?: string) {
        super(nativeId);

        this.console.log("Rachio Smart Home Timer Plugin Loaded")
    } 

    getApiKey() {
        return this.storage.getItem("api-key")
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
              key: "api-key",
              title: "Rachio API Key",
              value: this.getApiKey(),
              description:
                "You can find your API key in the Rachio app under account.",
            }
        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        value ? this.storage.setItem(key, value.toString()) : this.console.log(`Failed to update ${key}, value is undefined`);
        this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        
        // If the user updated their api-key, get a list of valves
        if (key === "api-key") {
            axios.defaults.headers.common['Authorization'] = `Bearer ${value ? value.toString() : ""}` 
            this.getRachioValves();
        }
    }
    
    async getRachioValves() {
        this.console.log("Preparing to get a list of Rachio Valves");
    
        // If there's no api-key, no need to continue
        if (this.isNullOrEmpty(this.getApiKey())) {
            this.console.log("Please enter your API key.");
            return;
        }
    
        // Get the user's ID
        const userId = await this.getRachioUser();
        if (this.isNullOrEmpty(userId)) {
            this.console.log("Failed to get Rachio user");
            return;
        } else {
            this.storage.setItem('rachio-user', userId);
        }
    
        // Get a list of base stations for the user
        const baseStations = await this.getRachioBaseStations(userId);
        if (this.isNullOrEmpty(baseStations)) {
            this.console.log("Failed to get Rachio Base Stations");
            return;
        }
    
        // Use Promise.all to wait for all valve fetching operations to complete
        const valvePromises = baseStations.map<Promise<Array<any>>>(async station => {
            this.console.log(`Getting valves for Base Station ${station.serialNumber}`);
            const stationValves = await this.getBaseStationValves(station.id);
            this.console.log(`Found ${stationValves.length} valves for Base Station ${station.serialNumber}`);
            return stationValves;
        });
    
        const valvesArrays = await Promise.all(valvePromises);
        const valves = valvesArrays.flat();
    
        this.console.log(`Found ${valves.length} valves total`);
    
        // Create a new Irrigation object for each valve we found
        const irrigationDevices = valves.map(valve => {
            this.console.log(`Adding valve: ${valve.name}`);
            return {
                nativeId: valve.id,
                name: valve.name,
                type: ScryptedDeviceType.Irrigation,
                interfaces: [ScryptedInterface.OnOff]
            };
        });
    
        if (irrigationDevices.length > 0) {
            await sdk.deviceManager.onDevicesChanged({
                devices: irrigationDevices
            });
        }
    }

    isNullOrEmpty(value: any): Boolean {
        return value === null ? true : value === undefined ? true : value === '' ? true : false
    }


    async getRachioUser() {
        try {
            const response = await axios.get('https://api.rach.io/1/public/person/info');
            return response.data.id
        } catch (error) {
            this.console.error('Error getting Rachio user:', error);
            throw error;
        }
    }
    
    async getRachioBaseStations(userId: string): Promise<Array<any>> {
        try {
            const response = await axios.get(`https://cloud-rest.rach.io/valve/listBaseStations/${userId}`);
            return response.data.baseStations
        } catch (error) {
            this.console.error('Error getting Rachio Base Stations:', error);
            throw error;
        }
    }

    async getBaseStationValves(baseStationId: string): Promise<Array<Object>> {
        try {
            const response = await axios.get(`https://cloud-rest.rach.io/valve/listValves/${baseStationId}`);
            return response.data.valves
        } catch (error) {
            this.console.error(`Error getting valves for Base Station ${baseStationId}:`, error);
            throw error;
        }
    }

    async turnOnValve(valveId: string) {
        try {
            const data = {
                valveId: valveId,
                durationSeconds: 1800
            }
            const response = await axios.put(`https://cloud-rest.rach.io/valve/startWatering`, data);
            return response.data.valves
        } catch (error) {
            this.console.error(`Error turning on valve ${valveId}:`, error);
            throw error;
        }
    }

    async turnOffValve(valveId: string) {
        try {
            const data = {
                valveId: valveId,
            }
            const response = await axios.put(`https://cloud-rest.rach.io/valve/stopWatering`, data);
            return response.data.valves
        } catch (error) {
            this.console.error(`Error turning off valve ${valveId}:`, error);
            throw error;
        }
    }

    async getDevice(nativeId: ScryptedNativeId): Promise<any> {
        if (nativeId === undefined) {
            this.console.log("Attempted to get a device with an undefined nativeId");
            return undefined;
        } else {
            return new RachioSmartHoseTimer(this, nativeId);
        }
    }

    async releaseDevice(id: string, nativeId: ScryptedNativeId): Promise<void> {
        this.console.log(`Device removed ${nativeId}`);
    }
    
}

export default RachioSmartHoseTimerPlugin;
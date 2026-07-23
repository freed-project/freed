import {
  friendsGalaxyProductWorkerResponseTransferables,
  type FriendsGalaxyProductWorkerRequest,
} from "./friends-galaxy-product-worker-protocol.js";
import { FriendsGalaxyProductWorkerService } from "./friends-galaxy-product-worker-service.js";

const service = new FriendsGalaxyProductWorkerService();

self.onmessage = (event: MessageEvent<FriendsGalaxyProductWorkerRequest>) => {
  const response = service.handle(event.data);
  self.postMessage(
    response,
    friendsGalaxyProductWorkerResponseTransferables(response),
  );
};

export {};

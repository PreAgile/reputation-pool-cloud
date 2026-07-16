package io.github.preagile.reputationpool.cloud.grpc;

import io.github.preagile.reputationpool.core.pool.ResourcePool;
import io.github.preagile.reputationpool.grpc.EventBroadcaster;
import net.devh.boot.grpc.server.service.GrpcService;

/**
 * The Spring-registered gRPC service: a thin {@link GrpcService} adapter over the shared handler in the
 * published {@code reputation-pool-grpc} module. All six RPC handlers — decode, one pool call, encode —
 * live in the base class; cloud supplies only the framework registration and the injected pool and
 * broadcaster beans. This is the whole "thin layer" cloud adds on top of the reusable gRPC surface.
 */
@GrpcService
public class ReputationAdvisorService extends io.github.preagile.reputationpool.grpc.ReputationAdvisorService {

    public ReputationAdvisorService(ResourcePool pool, EventBroadcaster broadcaster) {
        super(pool, broadcaster);
    }
}

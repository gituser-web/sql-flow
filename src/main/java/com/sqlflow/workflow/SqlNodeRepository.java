package com.sqlflow.workflow;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface SqlNodeRepository extends JpaRepository<SqlNodeEntity, Long> {

    List<SqlNodeEntity> findByStageIdOrderByOrderIndexAsc(Long stageId);

    long countByStageId(Long stageId);

    long countByStageIdIn(Collection<Long> stageIds);

    void deleteByStageId(Long stageId);
}

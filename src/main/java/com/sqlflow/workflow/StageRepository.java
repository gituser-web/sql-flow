package com.sqlflow.workflow;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface StageRepository extends JpaRepository<StageEntity, Long> {

    List<StageEntity> findByWorkflowIdOrderByOrderIndexAsc(Long workflowId);

    long countByWorkflowId(Long workflowId);

    void deleteByWorkflowId(Long workflowId);
}

package com.sqlflow.workflow;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface WorkflowRepository extends JpaRepository<WorkflowEntity, Long> {

    Optional<WorkflowEntity> findByCode(String code);

    List<WorkflowEntity> findAllByOrderByIdDesc();
}

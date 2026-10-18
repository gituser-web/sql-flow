package com.sqlflow.openapi;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ApiDefRepository extends JpaRepository<ApiDef, Long> {
    Optional<ApiDef> findByCode(String code);
    List<ApiDef> findAllByOrderByIdDesc();
    boolean existsByWorkflowId(Long workflowId);
}

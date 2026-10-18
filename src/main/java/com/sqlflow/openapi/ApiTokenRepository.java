package com.sqlflow.openapi;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ApiTokenRepository extends JpaRepository<ApiTokenEntity, Long> {
    Optional<ApiTokenEntity> findByToken(String token);
    List<ApiTokenEntity> findAllByOrderByIdDesc();
}
